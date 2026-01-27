"""Export all data to static JSON files for Vercel deployment."""
import json
import pandas as pd
from datetime import timedelta
from pathlib import Path

DATA_PATH = "/Users/dm1223/Desktop/Barclays-compass/data/raw/v2025.12.08.1716/broadband_processed_data.parquet"
OUTPUT_DIR = Path("/Users/dm1223/Desktop/Barclays-compass/frontend/public/data")

def process_dataset(input_path: str):
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

    existing_cols = [c for c in columns_to_keep if c in data.columns]
    cleaned = data.loc[:, existing_cols]

    if 'primary_merchant' in cleaned.columns:
        cleaned = cleaned.loc[cleaned['primary_merchant'] != '']

    if 'transaction_classification_0' in cleaned.columns:
        cleaned = cleaned[~cleaned['transaction_classification_0'].str.contains('|', regex=False, na=False)]

    customer_txn_counts = cleaned.groupby('customer_id').size()
    total_cust_10plus = int((customer_txn_counts >= 10).sum())

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

    return classification_summary, merchant_summary, total_cust_10plus, cleaned


def compute_customer_segmentation(data: pd.DataFrame):
    """Compute customer segmentation based on top 2/4 brands per customer."""
    data = data.copy()
    data['date'] = pd.to_datetime(data['date'])

    customer_last_date = data.groupby('customer_id')['date'].max().reset_index()
    customer_last_date.columns = ['customer_id', 'last_date']

    data = data.merge(customer_last_date, on='customer_id')
    data['cutoff_date'] = data['last_date'] - timedelta(days=60)
    data_filtered = data[data['date'] >= data['cutoff_date']]

    customer_brand_stats = data_filtered.groupby(['customer_id', 'primary_merchant']).agg(
        txn_count=('amount', 'count'),
        total_amount=('amount', 'sum')
    ).reset_index()

    txn_min, txn_max = customer_brand_stats['txn_count'].min(), customer_brand_stats['txn_count'].max()
    amt_min, amt_max = customer_brand_stats['total_amount'].min(), customer_brand_stats['total_amount'].max()

    customer_brand_stats['norm_txn'] = (customer_brand_stats['txn_count'] - txn_min) / (txn_max - txn_min) if txn_max > txn_min else 0.5
    customer_brand_stats['norm_amt'] = (customer_brand_stats['total_amount'] - amt_min) / (amt_max - amt_min) if amt_max > amt_min else 0.5

    customer_brand_stats['score'] = (
        0.2 * customer_brand_stats['norm_txn'] +
        0.8 * customer_brand_stats['norm_amt']
    )

    customer_brand_stats = customer_brand_stats.sort_values(
        ['customer_id', 'score'], ascending=[True, False]
    )

    top2_per_customer = customer_brand_stats.groupby('customer_id').head(2)
    top4_per_customer = customer_brand_stats.groupby('customer_id').head(4)

    customer_brands = top2_per_customer.groupby('customer_id').agg(
        brands=('primary_merchant', list)
    ).reset_index()

    customer_brands = customer_brands[customer_brands['brands'].apply(len) >= 2]
    sample_customers = customer_brands.head(10).to_dict('records')

    all_top_brands = top4_per_customer.groupby('primary_merchant').agg(
        customer_count=('customer_id', 'nunique')
    ).reset_index()
    all_top_brands = all_top_brands.sort_values('customer_count', ascending=False)
    top10_brands = all_top_brands.head(10).to_dict('records')

    return {
        "sample_customers": sample_customers,
        "top10_brands": top10_brands,
        "total_customers_analyzed": len(customer_brands)
    }


def get_recommendations(classification_data, merchant_data, total_customers, x=35.0, y=30.0):
    """Get recommendations based on thresholds."""
    min_class_customers = total_customers * (x / 100)
    top_classifications = classification_data[
        classification_data['customers_with_10plus_txn'] >= min_class_customers
    ]

    results = []
    for _, class_row in top_classifications.iterrows():
        class_name = class_row['transaction_classification_0']
        class_customers = class_row['customers_with_10plus_txn']
        min_merchant_customers = class_customers * (y / 100)

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

    results.sort(key=lambda r: r['merchant_customers'], reverse=True)

    return {
        "total_customers": total_customers,
        "threshold_x": x,
        "threshold_y": y,
        "top_classifications_count": len(top_classifications),
        "recommendations": results
    }


def main():
    print("Loading data...")
    classification_data, merchant_data, total_customers, raw_data = process_dataset(DATA_PATH)

    # 1. Export classification data (3D plot)
    print("Exporting classification data...")
    classification_json = {
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
    with open(OUTPUT_DIR / "classifications.json", "w") as f:
        json.dump(classification_json, f)

    # 2. Export merchant data for each classification
    print("Exporting merchant data...")
    merchants_by_class = {}
    for classification in classification_data['transaction_classification_0'].unique():
        filtered = merchant_data[merchant_data['transaction_classification_0'] == classification]
        if not filtered.empty:
            merchants_by_class[classification] = {
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
    with open(OUTPUT_DIR / "merchants.json", "w") as f:
        json.dump(merchants_by_class, f)

    # 3. Export recommendations (default thresholds)
    print("Exporting recommendations...")
    recommendations = get_recommendations(classification_data, merchant_data, total_customers)
    with open(OUTPUT_DIR / "recommendations.json", "w") as f:
        json.dump(recommendations, f)

    # 4. Export segmentation data
    print("Exporting segmentation data...")
    segmentation = compute_customer_segmentation(raw_data)
    with open(OUTPUT_DIR / "segmentation.json", "w") as f:
        json.dump(segmentation, f)

    print(f"Done! Files exported to {OUTPUT_DIR}")
    print(f"  - classifications.json")
    print(f"  - merchants.json")
    print(f"  - recommendations.json")
    print(f"  - segmentation.json")


if __name__ == "__main__":
    main()
