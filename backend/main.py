from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import tempfile
import os
from datetime import timedelta

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pre-processed data storage
DATA_PATH = "/Users/dm1223/Desktop/Barclays-compass/data/raw/v2025.12.08.1716/broadband_processed_data.parquet"
classification_data = None
merchant_data = None
total_customers = 0
raw_data = None  # Store raw data for customer segmentation
customer_segmentation = None  # Store computed segmentation


def process_dataset(input_path: str) -> tuple:
    """Process transaction dataset and return classification and merchant summaries."""
    data = pd.read_parquet(input_path).drop_duplicates()

    columns_to_keep = [
        'primary_merchant',
        'transaction_classification_0',
        'transaction_classification_1',
        'customer_id',
        'account_id',
        'date',
        'amount',
        'transaction_direction'
    ]

    # Only keep columns that exist
    existing_cols = [c for c in columns_to_keep if c in data.columns]
    cleaned = data.loc[:, existing_cols]

    # Filter out empty merchants if column exists
    if 'primary_merchant' in cleaned.columns:
        cleaned = cleaned.loc[cleaned['primary_merchant'] != '']

    # Filter out multi-category classifications
    if 'transaction_classification_0' in cleaned.columns:
        cleaned = cleaned[~cleaned['transaction_classification_0'].str.contains('|', regex=False, na=False)]

    # Count total unique customers with 10+ transactions
    customer_txn_counts = cleaned.groupby('customer_id').size()
    total_cust_10plus = int((customer_txn_counts >= 10).sum())

    # Build classification-level summary
    customer_class_stats = cleaned.groupby(
        ['transaction_classification_0', 'customer_id']
    ).agg(
        txn_count=('amount', 'count'),
        total_amount=('amount', 'sum')
    ).reset_index()

    classification_summary = customer_class_stats.groupby('transaction_classification_0').agg(
        median_txn_per_customer=('txn_count', 'median'),
        median_amount_per_customer=('total_amount', 'median'),
        customers_with_10plus_txn=('txn_count', lambda x: (x >= 10).sum())
    ).reset_index()

    # Build merchant-level summary grouped by classification
    customer_merchant_stats = cleaned.groupby(
        ['transaction_classification_0', 'primary_merchant', 'customer_id']
    ).agg(
        txn_count=('amount', 'count'),
        total_amount=('amount', 'sum')
    ).reset_index()

    merchant_summary = customer_merchant_stats.groupby(
        ['transaction_classification_0', 'primary_merchant']
    ).agg(
        median_txn_per_customer=('txn_count', 'median'),
        median_amount_per_customer=('total_amount', 'median'),
        customers_with_10plus_txn=('txn_count', lambda x: (x >= 10).sum())
    ).reset_index()

    return classification_summary, merchant_summary, total_cust_10plus


def compute_customer_segmentation(data: pd.DataFrame) -> dict:
    """
    Compute customer segmentation based on top 2 brands per customer.

    For each customer:
    - Look at last 2 months of transactions (relative to their most recent transaction)
    - Score brands: 0.2 * txn_count + 0.8 * total_amount
    - Get top 2 brands
    """
    # Ensure date column is datetime
    data = data.copy()
    data['date'] = pd.to_datetime(data['date'])

    # Get each customer's most recent transaction date
    customer_last_date = data.groupby('customer_id')['date'].max().reset_index()
    customer_last_date.columns = ['customer_id', 'last_date']

    # Merge to get last_date for each transaction
    data = data.merge(customer_last_date, on='customer_id')

    # Filter to last 2 months for each customer
    data['cutoff_date'] = data['last_date'] - timedelta(days=60)
    data_filtered = data[data['date'] >= data['cutoff_date']]

    # Calculate score per customer-brand: 0.2 * normalized_txn + 0.8 * normalized_amount
    customer_brand_stats = data_filtered.groupby(['customer_id', 'primary_merchant']).agg(
        txn_count=('amount', 'count'),
        total_amount=('amount', 'sum')
    ).reset_index()

    # Normalize to 0-1 scale
    txn_min, txn_max = customer_brand_stats['txn_count'].min(), customer_brand_stats['txn_count'].max()
    amt_min, amt_max = customer_brand_stats['total_amount'].min(), customer_brand_stats['total_amount'].max()

    customer_brand_stats['norm_txn'] = (customer_brand_stats['txn_count'] - txn_min) / (txn_max - txn_min) if txn_max > txn_min else 0.5
    customer_brand_stats['norm_amt'] = (customer_brand_stats['total_amount'] - amt_min) / (amt_max - amt_min) if amt_max > amt_min else 0.5

    customer_brand_stats['score'] = (
        0.2 * customer_brand_stats['norm_txn'] +
        0.8 * customer_brand_stats['norm_amt']
    )

    # Sort by customer and score
    customer_brand_stats = customer_brand_stats.sort_values(
        ['customer_id', 'score'], ascending=[True, False]
    )

    # Get top 2 brands per customer (for Customer Segmentation)
    top2_per_customer = customer_brand_stats.groupby('customer_id').head(2)

    # Get top 4 brands per customer (for Gap Analysis)
    top4_per_customer = customer_brand_stats.groupby('customer_id').head(4)

    # Create customer -> top 2 brands mapping for display
    customer_brands = top2_per_customer.groupby('customer_id').agg(
        brands=('primary_merchant', list)
    ).reset_index()

    # Filter to customers with at least 2 brands
    customer_brands = customer_brands[customer_brands['brands'].apply(len) >= 2]

    # Get 10 sample customers (just customer_id and brands, no scores)
    sample_customers = customer_brands.head(10).to_dict('records')

    # Aggregate: count how many customers have each brand in their top 4 (for Gap Analysis)
    all_top_brands = top4_per_customer.groupby('primary_merchant').agg(
        customer_count=('customer_id', 'nunique')
    ).reset_index()
    all_top_brands = all_top_brands.sort_values('customer_count', ascending=False)

    # Get top 10 brands for gap analysis
    top10_brands = all_top_brands.head(10).to_dict('records')

    return {
        "sample_customers": sample_customers,
        "top10_brands": top10_brands,
        "total_customers_analyzed": len(customer_brands)
    }


@app.post("/api/process")
async def process_file(file: UploadFile = File(...)):
    """Process uploaded parquet file and return 3D graph data."""
    if not file.filename.endswith('.parquet'):
        raise HTTPException(status_code=400, detail="File must be a .parquet file")

    try:
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix='.parquet') as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        # Process the dataset
        classification_summary, merchant_summary = process_dataset(tmp_path)

        # Clean up temp file
        os.unlink(tmp_path)

        # Store merchant data for drill-down
        session_id = str(abs(hash(file.filename + str(len(classification_summary)))))
        processed_data_store[session_id] = merchant_summary

        # Return data for 3D visualization
        return {
            "session_id": session_id,
            "labels": classification_summary['transaction_classification_0'].tolist(),
            "x": classification_summary['median_txn_per_customer'].tolist(),
            "y": classification_summary['median_amount_per_customer'].tolist(),
            "z": classification_summary['customers_with_10plus_txn'].tolist(),
            "axis_labels": {
                "x": "Median Transactions per Customer",
                "y": "Median Amount per Customer",
                "z": "Customers with 10+ Transactions"
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/merchants/{session_id}/{classification}")
async def get_merchants(session_id: str, classification: str):
    """Get merchant-level data for a specific classification."""
    if session_id not in processed_data_store:
        raise HTTPException(status_code=404, detail="Session not found. Please re-upload the file.")

    merchant_data = processed_data_store[session_id]
    filtered = merchant_data[merchant_data['transaction_classification_0'] == classification]

    if filtered.empty:
        raise HTTPException(status_code=404, detail=f"No merchants found for classification: {classification}")

    return {
        "classification": classification,
        "labels": filtered['primary_merchant'].tolist(),
        "x": filtered['median_txn_per_customer'].tolist(),
        "y": filtered['median_amount_per_customer'].tolist(),
        "z": filtered['customers_with_10plus_txn'].tolist(),
        "axis_labels": {
            "x": "Median Transactions per Customer",
            "y": "Median Amount per Customer",
            "z": "Customers with 10+ Transactions"
        }
    }


@app.on_event("startup")
async def startup_event():
    """Pre-process the dataset on server startup."""
    global classification_data, merchant_data, total_customers, raw_data, customer_segmentation
    print(f"Loading and processing {DATA_PATH}...")
    classification_data, merchant_data, total_customers = process_dataset(DATA_PATH)
    print(f"Loaded {len(classification_data)} classifications, {len(merchant_data)} merchant entries, {total_customers} total customers with 10+ txn")

    # Load raw data for segmentation
    print("Computing customer segmentation...")
    raw_data = pd.read_parquet(DATA_PATH).drop_duplicates()
    if 'primary_merchant' in raw_data.columns:
        raw_data = raw_data[raw_data['primary_merchant'] != '']
    customer_segmentation = compute_customer_segmentation(raw_data)
    print(f"Segmentation complete: {customer_segmentation['total_customers_analyzed']} customers analyzed")


@app.get("/api/data")
async def get_data():
    """Get pre-processed classification data."""
    if classification_data is None:
        raise HTTPException(status_code=500, detail="Data not loaded")

    return {
        "labels": classification_data['transaction_classification_0'].tolist(),
        "x": classification_data['median_txn_per_customer'].tolist(),
        "y": classification_data['median_amount_per_customer'].tolist(),
        "z": classification_data['customers_with_10plus_txn'].tolist(),
        "axis_labels": {
            "x": "Median Transactions per Customer",
            "y": "Median Amount per Customer",
            "z": "Customers with 10+ Transactions"
        }
    }


@app.get("/api/merchants/{classification}")
async def get_merchants_simple(classification: str):
    """Get merchant-level data for a specific classification."""
    if merchant_data is None:
        raise HTTPException(status_code=500, detail="Data not loaded")

    filtered = merchant_data[merchant_data['transaction_classification_0'] == classification]

    if filtered.empty:
        raise HTTPException(status_code=404, detail=f"No merchants found for: {classification}")

    return {
        "classification": classification,
        "labels": filtered['primary_merchant'].tolist(),
        "x": filtered['median_txn_per_customer'].tolist(),
        "y": filtered['median_amount_per_customer'].tolist(),
        "z": filtered['customers_with_10plus_txn'].tolist(),
        "axis_labels": {
            "x": "Median Transactions per Customer",
            "y": "Median Amount per Customer",
            "z": "Customers with 10+ Transactions"
        }
    }


@app.get("/api/recommendations")
async def get_recommendations(x: float = 35.0, y: float = 50.0):
    """
    Get top merchant recommendations based on customer involvement thresholds.

    Args:
        x: Minimum % of total customers for a classification to be considered (default 35%)
        y: Minimum % of classification customers for a merchant to be recommended (default 50%)
    """
    if classification_data is None or merchant_data is None:
        raise HTTPException(status_code=500, detail="Data not loaded")

    # Step 1: Filter classifications with more than x% of total customers
    min_class_customers = total_customers * (x / 100)
    top_classifications = classification_data[
        classification_data['customers_with_10plus_txn'] >= min_class_customers
    ]

    results = []

    # Step 2: For each top classification, find merchants with more than y% of that classification's customers
    for _, class_row in top_classifications.iterrows():
        class_name = class_row['transaction_classification_0']
        class_customers = class_row['customers_with_10plus_txn']
        min_merchant_customers = class_customers * (y / 100)

        # Get merchants in this classification
        class_merchants = merchant_data[
            (merchant_data['transaction_classification_0'] == class_name) &
            (merchant_data['customers_with_10plus_txn'] >= min_merchant_customers)
        ].copy()

        for _, merch_row in class_merchants.iterrows():
            results.append({
                "classification": class_name,
                "classification_customers": int(class_customers),
                "classification_pct": round(class_customers / total_customers * 100, 1),
                "merchant": merch_row['primary_merchant'],
                "merchant_customers": int(merch_row['customers_with_10plus_txn']),
                "merchant_pct_of_classification": round(merch_row['customers_with_10plus_txn'] / class_customers * 100, 1),
                "median_txn": float(merch_row['median_txn_per_customer']),
                "median_amount": float(merch_row['median_amount_per_customer'])
            })

    # Sort by merchant_customers descending
    results.sort(key=lambda r: r['merchant_customers'], reverse=True)

    return {
        "total_customers": total_customers,
        "threshold_x": x,
        "threshold_y": y,
        "top_classifications_count": len(top_classifications),
        "recommendations": results
    }


@app.get("/api/segmentation")
async def get_segmentation():
    """Get customer segmentation data - top 2 brands per customer analysis."""
    if customer_segmentation is None:
        raise HTTPException(status_code=500, detail="Segmentation data not loaded")

    return customer_segmentation


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
