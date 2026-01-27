import pandas as pd
from pathlib import Path


def process_dataset(input_path: str, output_path: str = None, table_output_path: str = None) -> pd.DataFrame:
    """
    Clean and process transaction dataset.

    Args:
        input_path: Path to input parquet file
        output_path: Path to save cleaned parquet (optional)
        table_output_path: Path to save summary table (optional)

    Returns:
        Tuple of (cleaned DataFrame, summary table by classification)
    """
    # Load data
    data = pd.read_parquet(input_path).drop_duplicates()

    # Select relevant columns
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

    cleaned = data.loc[:, columns_to_keep]

    # Filter out empty merchants
    cleaned = cleaned.loc[cleaned['primary_merchant'] != '']

    # Filter out multi-category classifications (containing "|")
    cleaned = cleaned[~cleaned['transaction_classification_0'].str.contains('|', regex=False, na=False)]

    # Build summary table by transaction_classification_0
    customer_class_stats = cleaned.groupby(
        ['transaction_classification_0', 'customer_id']
    ).agg(
        txn_count=('amount', 'count'),
        total_amount=('amount', 'sum')
    ).reset_index()

    summary_table = customer_class_stats.groupby('transaction_classification_0').agg(
        median_txn_per_customer=('txn_count', 'median'),
        median_amount_per_customer=('total_amount', 'median'),
        customers_with_10plus_txn=('txn_count', lambda x: (x >= 10).sum())
    )

    # Save if output path provided
    if output_path:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        cleaned.to_parquet(output_path, index=False)
        print(f"Saved cleaned data to {output_path}")

    if table_output_path:
        Path(table_output_path).parent.mkdir(parents=True, exist_ok=True)
        summary_table.to_parquet(table_output_path)
        print(f"Saved summary table to {table_output_path}")

    print(f"Processed: {len(data):,} -> {len(cleaned):,} rows")
    return cleaned, summary_table


if __name__ == "__main__":
    # Example usage
    cleaned, summary_table = process_dataset(
        input_path="data/raw/v2025.12.08.1716/broadband_processed_data.parquet",
        output_path="data/cleaned/columns_selected.parquet",
        table_output_path="data/table/classification_summary.parquet"
    )
    print("\n=== Summary Table by Classification ===")
    print(summary_table.to_string())
