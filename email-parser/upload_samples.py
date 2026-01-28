"""Upload local sample reports to the API without email ingestion."""

from pathlib import Path
from datetime import datetime

from parser import EmailParser

SAMPLES_DIR = Path(__file__).resolve().parent.parent / "sample-csvs"


def main() -> None:
    parser = EmailParser()
    samples = [
        ("Leasing Report", SAMPLES_DIR / "guest_card_inquiries-20260127.xlsx", "inquiries", parser.parse_leasing_report),
        ("Property Report", SAMPLES_DIR / "rent_roll_itemized-20260127.xlsx", "property-reports", parser.parse_property_report),
    ]

    for label, path, endpoint, parse_fn in samples:
        if not path.exists():
            print(f"Skipping {label}: {path.name} not found")
            continue

        file_content = path.read_bytes()
        records = parse_fn(file_content)
        if not records:
            print(f"No records parsed for {label}")
            continue

        metadata = {
            "filename": path.name,
            "email_subject": f"Local sample upload - {label}",
            "email_date": datetime.now().isoformat(),
            "received_at": datetime.now().isoformat(),
        }

        success = parser.send_to_api(endpoint, records, metadata)
        print(f"{label}: {'uploaded' if success else 'failed'} ({len(records)} records)")


if __name__ == "__main__":
    main()
