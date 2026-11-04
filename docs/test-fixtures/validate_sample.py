"""Validate the synthetic Sports Connect CSV against the supplied 2027 age chart.

Run from any directory:
  python docs/test-fixtures/validate_sample.py
This checks fixture shape only; it does not connect to or write to Supabase.
"""
import csv
from collections import Counter
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
CSV_PATH = HERE / "sports-connect-sample-spring-2027-fake.csv"
CHART_PATH = HERE / "little-league-baseball-age-chart-2027.csv"
MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")

with CHART_PATH.open(encoding="utf-8-sig", newline="") as f:
    chart_rows = list(csv.DictReader(f))
age_by_year_month = {
    (int(row[month]), month_index + 1): int(row["AGE"])
    for row in chart_rows
    for month_index, month in enumerate(MONTHS)
}

with CSV_PATH.open(encoding="utf-8-sig", newline="") as f:
    reader = csv.DictReader(f)
    rows = list(reader)
    headers = reader.fieldnames or []

required = {
    "Player Id", "Division Name", "Registration Number", "Player First Name",
    "Player Last Name", "Player Birth Date", "Order Payment Status", "Program Name",
}
assert required.issubset(headers), f"Missing expected headers: {sorted(required - set(headers))}"
assert len(rows) == 323, f"Expected 323 rows, found {len(rows)}"
ids = [row["Player Id"].strip() for row in rows]
assert all(ids), "Every row must have a Player Id"
assert len(ids) == len(set(ids)), "Duplicate Player Id found"
status_counts = Counter(row["Order Payment Status"].strip() for row in rows)
assert status_counts == Counter({"Completed": 286, "Pending": 37}), status_counts
assert all(not row["Registration Number"].strip() for row in rows), "Expected blank registration numbers in this fixture"
age_counts = Counter()
for row_number, row in enumerate(rows, start=2):
    birthdate = datetime.strptime(row["Player Birth Date"].strip(), "%m/%d/%Y").date()
    key = (birthdate.year, birthdate.month)
    assert key in age_by_year_month, f"No age chart entry for row {row_number}: {birthdate}"
    age_counts[age_by_year_month[key]] += 1

print("PASS: 323 rows; unique nonblank Player Ids; status counts correct; registration numbers blank; all birthdates map to the supplied 2027 chart.")
print("Division counts:", dict(Counter(row["Division Name"].strip() for row in rows)))
print("Age counts:", dict(sorted(age_counts.items())))
