"""Shared builder for the test plan workbooks (Overview, Script, DB checks, Notes and problems). Needs openpyxl.
Used by scripts/build-test-plan-season-setup.py and scripts/build-test-plan-draft.py."""
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule

FONT = "Arial"
GREEN = "1B5E20"
LIGHT = "E3EFE5"
BANNER_FILL = PatternFill("solid", fgColor=GREEN)
HEAD_FILL = PatternFill("solid", fgColor=LIGHT)
INPUT_FILL = PatternFill("solid", fgColor="FFF9DB")
EXAMPLE_FONT = Font(name=FONT, size=9, italic=True, color="7F7F7F")
thin = Side(style="thin", color="B7C4BA")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
WRAP = Alignment(wrap_text=True, vertical="top")


def f(size=10, bold=False, color="000000", italic=False):
    return Font(name=FONT, size=size, bold=bold, color=color, italic=italic)


def build(out, subtitle, intro, PHASES, DB_CHECKS, cast_rows, hosting_notes, example_row, extra_sheets=None):
    """PHASES: [(phase, minutes, summary, [(id, who, where, what to do, what you should see, must_pass)])];
    DB_CHECKS: [(id, when, what, sql, expected)]; cast_rows: [(role, login)]; hosting_notes: [text];
    example_row: the 8 cells of the grey example row on the Script sheet.
    extra_sheets: optional [(title, intro, headers, widths, rows)] added after the Script sheet (plain tables)."""
    wb = Workbook()

    # ---------------------------------------------------------------- Overview
    ov = wb.active
    ov.title = "Overview"
    ov.sheet_view.showGridLines = False
    ov.column_dimensions["A"].width = 4
    ov.column_dimensions["B"].width = 44
    ov.column_dimensions["C"].width = 70
    ov.column_dimensions["D"].width = 14
    ov["B1"] = "RWCLL Player Evaluations"
    ov["B1"].font = f(18, True, GREEN)
    ov["B2"] = subtitle
    ov["B2"].font = f(13, True)
    ov["B3"] = intro
    ov["B3"].font = f(10)
    ov["B3"].alignment = WRAP
    ov.merge_cells("B3:D3")
    ov.row_dimensions[3].height = 30
    ov["B5"] = "Date run:"
    ov["C5"] = ""
    ov["B6"] = "Where (local / hosted):"
    ov["B7"] = "Tester:"
    for r in (5, 6, 7):
        ov[f"B{r}"].font = f(10, True)
        ov[f"C{r}"].fill = INPUT_FILL
        ov[f"C{r}"].border = BOX

    row = 9
    ov[f"B{row}"] = "The plan at a glance"
    ov[f"B{row}"].font = f(12, True, GREEN)
    row += 1
    for col, text in zip("BCD", ("Phase" if not PHASES[0][0].startswith("Stage") else "Stage", "What happens", "Minutes")):
        c = ov[f"{col}{row}"]
        c.value = text
        c.font = f(10, True)
        c.fill = HEAD_FILL
        c.border = BOX
    first_phase_row = row + 1
    for name, minutes, summary, _ in PHASES:
        row += 1
        ov[f"B{row}"] = name
        ov[f"C{row}"] = summary
        ov[f"D{row}"] = minutes
        for col in "BCD":
            ov[f"{col}{row}"].font = f(10, col == "B")
            ov[f"{col}{row}"].alignment = WRAP
            ov[f"{col}{row}"].border = BOX
    last_phase_row = row
    row += 1
    ov[f"C{row}"] = "Total minutes"
    ov[f"C{row}"].font = f(10, True)
    ov[f"C{row}"].alignment = Alignment(horizontal="right")
    ov[f"D{row}"] = f"=SUM(D{first_phase_row}:D{last_phase_row})"
    ov[f"D{row}"].font = f(10, True)

    row += 2
    ov[f"B{row}"] = "Results so far (filled in from the Script sheet)"
    ov[f"B{row}"].font = f(12, True, GREEN)
    summary_start = row + 1
    results = [
        ("Steps", '=COUNTA(Script!A:A)-COUNTIF(Script!A:A,"Phase*")-COUNTIF(Script!A:A,"Stage*")-COUNTIF(Script!A:A,"#")-COUNTIF(Script!A:A,"Example")'),
        ("Pass", '=COUNTIF(Script!G:G,"Pass")'),
        ("Fail", '=COUNTIF(Script!G:G,"Fail")'),
        ("Skipped", '=COUNTIF(Script!G:G,"Skipped")'),
        ("Not done yet", f"=B{summary_start}-B{summary_start+1}-B{summary_start+2}-B{summary_start+3}"),
        ("Must-pass steps", '=COUNTIF(Script!F:F,"★")'),
        ("Must-pass steps that failed", '=COUNTIFS(Script!F:F,"★",Script!G:G,"Fail")'),
    ]
    for i, (label, formula) in enumerate(results):
        r = summary_start + i
        ov[f"C{r}"] = label
        ov[f"C{r}"].font = f(10, label.startswith("Must-pass steps that"))
        ov[f"C{r}"].alignment = Alignment(horizontal="right")
        ov[f"D{r}"] = formula
        ov[f"D{r}"].font = f(10, True)
        ov[f"D{r}"].border = BOX
    # The "Not done yet" formula refers to the column-D cells; fix the column letter.
    ov[f"D{summary_start+4}"] = f"=D{summary_start}-D{summary_start+1}-D{summary_start+2}-D{summary_start+3}"
    ov.conditional_formatting.add(f"D{summary_start+6}", CellIsRule(operator="greaterThan", formula=["0"],
                                  fill=PatternFill("solid", fgColor="F8D7DA"), font=Font(name=FONT, bold=True, color="9C0006")))
    row = summary_start + len(results) + 1

    ov[f"B{row}"] = "How to fill it in"
    ov[f"B{row}"].font = f(12, True, GREEN)
    legend = [
        "Script sheet: pick Pass, Fail or Skipped in the Result column (yellow), and write anything odd in Notes (yellow).",
        "A star (★) in the Must-pass column marks the minimum the app has to do. Any must-pass Fail means it isn't ready for real people.",
        "The words on screen may differ slightly from the sheet. That's fine; note it if a button was hard to find.",
        "Stuck for 3 minutes? Write the step number and what you saw in Notes, mark it Fail or Skipped, and move on.",
        "Database checks (optional) are on the DB checks sheet. They only read data. Run them in the Supabase SQL Editor (hosted) or Studio (local).",
        "The grey italic row at the top of the Script sheet is an example of a filled-in row.",
    ]
    for text in legend:
        row += 1
        ov[f"B{row}"] = "•  " + text
        ov[f"B{row}"].font = f(10)
        ov[f"B{row}"].alignment = WRAP
        ov.merge_cells(f"B{row}:D{row}")
        ov.row_dimensions[row].height = 28

    row += 2
    ov[f"B{row}"] = "The cast and their logins"
    ov[f"B{row}"].font = f(12, True, GREEN)
    row += 1
    for col, text in zip("BCD", ("Role", "Login (email) and password", "Played by")):
        c = ov[f"{col}{row}"]
        c.value = text
        c.font = f(10, True)
        c.fill = HEAD_FILL
        c.border = BOX
    cast = cast_rows
    for role, login in cast:
        row += 1
        ov[f"B{row}"] = role
        ov[f"C{row}"] = login
        ov[f"D{row}"].fill = INPUT_FILL
        for col in "BCD":
            ov[f"{col}{row}"].font = f(10)
            ov[f"{col}{row}"].alignment = WRAP
            ov[f"{col}{row}"].border = BOX
    row += 1
    ov[f"B{row}"] = ("One person can play every role: use a normal window for the admin and a private window for the coach or evaluator. "
                     "Every account here is fictional (@example.com).")
    ov[f"B{row}"].font = f(9, italic=True, color="595959")
    ov[f"B{row}"].alignment = WRAP
    ov.merge_cells(f"B{row}:D{row}")
    ov.row_dimensions[row].height = 26

    row += 2
    ov[f"B{row}"] = "Local or hosted"
    ov[f"B{row}"].font = f(12, True, GREEN)
    notes = hosting_notes
    for text in notes:
        row += 1
        ov[f"B{row}"] = "•  " + text
        ov[f"B{row}"].font = f(10)
        ov[f"B{row}"].alignment = WRAP
        ov.merge_cells(f"B{row}:D{row}")
        ov.row_dimensions[row].height = 28

    # ---------------------------------------------------------------- Script
    sc = wb.create_sheet("Script")
    sc.sheet_view.showGridLines = False
    headers = ["#", "Who", "Where", "What to do", "What you should see", "Must-pass", "Result", "Notes"]
    widths = [6, 10, 22, 55, 55, 9, 11, 34]
    for i, (h, w) in enumerate(zip(headers, widths), start=1):
        col = sc.cell(row=1, column=i).column_letter
        sc.column_dimensions[col].width = w
        c = sc.cell(row=1, column=i, value=h)
        c.font = f(10, True)
        c.fill = HEAD_FILL
        c.border = BOX
        c.alignment = Alignment(vertical="center", wrap_text=True)
    sc.freeze_panes = "A2"

    result_dv = DataValidation(type="list", formula1='"Pass,Fail,Skipped"', allow_blank=True,
                               prompt="Pass, Fail or Skipped", promptTitle="Result")
    sc.add_data_validation(result_dv)

    r = 2
    example = example_row
    for i, v in enumerate(example, start=1):
        c = sc.cell(row=r, column=i, value=v)
        c.font = EXAMPLE_FONT
        c.alignment = WRAP
        c.border = BOX

    for name, minutes, summary, steps in PHASES:
        r += 1
        sc.cell(row=r, column=1, value=name)
        sc.merge_cells(start_row=r, start_column=1, end_row=r, end_column=8)
        c = sc.cell(row=r, column=1)
        c.value = f"{name}   ({summary} About {minutes} minutes.)"
        c.font = f(11, True, "FFFFFF")
        c.fill = BANNER_FILL
        c.alignment = Alignment(vertical="center", wrap_text=True)
        sc.row_dimensions[r].height = 22
        for sid, who, where, todo, see, must in steps:
            r += 1
            values = [sid, who, where, todo, see, "★" if must else "", None, None]
            for i, v in enumerate(values, start=1):
                c = sc.cell(row=r, column=i, value=v)
                c.font = f(10, bold=(i == 1 and must))
                c.alignment = WRAP
                c.border = BOX
            sc.cell(row=r, column=6).alignment = Alignment(horizontal="center", vertical="top")
            sc.cell(row=r, column=6).font = f(12, True, "B8860B")
            for col in (7, 8):
                sc.cell(row=r, column=col).fill = INPUT_FILL
            result_dv.add(sc.cell(row=r, column=7))
            longest = max(len(todo), len(see))
            sc.row_dimensions[r].height = max(30, min(150, 13 * (longest // 52 + 1)))
    last_script_row = r
    sc.conditional_formatting.add(f"G3:G{last_script_row}", CellIsRule(operator="equal", formula=['"Pass"'],
                                  fill=PatternFill("solid", fgColor="D4EDDA")))
    sc.conditional_formatting.add(f"G3:G{last_script_row}", CellIsRule(operator="equal", formula=['"Fail"'],
                                  fill=PatternFill("solid", fgColor="F8D7DA")))
    sc.conditional_formatting.add(f"G3:G{last_script_row}", CellIsRule(operator="equal", formula=['"Skipped"'],
                                  fill=PatternFill("solid", fgColor="E2E3E5")))
    sc.auto_filter.ref = f"A1:H{last_script_row}"
    sc.print_title_rows = "1:1"
    sc.page_setup.orientation = "landscape"
    sc.page_setup.fitToWidth = 1
    sc.page_setup.fitToHeight = 0
    sc.sheet_properties.pageSetUpPr.fitToPage = True

    # ---------------------------------------------------------------- DB checks
    db = wb.create_sheet("DB checks")
    db.sheet_view.showGridLines = False
    for col, w in zip("ABCDEF", (6, 16, 28, 80, 50, 11)):
        db.column_dimensions[col].width = w
    db["A1"] = "Database checks (read-only). Paste the SQL into the Supabase SQL Editor (hosted) or Studio's SQL editor (local) and run it."
    db["A1"].font = f(10, True, GREEN)
    db.merge_cells("A1:F1")
    for i, h in enumerate(["Check", "When", "What", "SQL (read-only)", "Expected", "Result"], start=1):
        c = db.cell(row=2, column=i, value=h)
        c.font = f(10, True)
        c.fill = HEAD_FILL
        c.border = BOX
    db_dv = DataValidation(type="list", formula1='"Pass,Fail,Skipped"', allow_blank=True)
    db.add_data_validation(db_dv)
    for i, (cid, when, what, sql, expected) in enumerate(DB_CHECKS, start=3):
        for j, v in enumerate([cid, when, what, sql, expected, None], start=1):
            c = db.cell(row=i, column=j, value=v)
            c.font = Font(name="Consolas", size=9) if j == 4 else f(10)
            c.alignment = WRAP
            c.border = BOX
        db.cell(row=i, column=6).fill = INPUT_FILL
        db_dv.add(db.cell(row=i, column=6))
        db.row_dimensions[i].height = max(45, 13 * (sql.count("\n") + 2))
    db.freeze_panes = "A3"

    # ---------------------------------------------------------------- Notes and problems
    np_ = wb.create_sheet("Notes and problems")
    np_.sheet_view.showGridLines = False
    for col, w in zip("ABCD", (10, 80, 16, 20)):
        np_.column_dimensions[col].width = w
    np_["A1"] = "One line per problem. Blocker = I couldn't continue. Annoying = it worked but was confusing or slow. Idea = something that would help."
    np_["A1"].font = f(10, True, GREEN)
    np_.merge_cells("A1:D1")
    for i, h in enumerate(["Step #", "What happened, or what confused you", "Blocker / Annoying / Idea", "Who saw it too?"], start=1):
        c = np_.cell(row=2, column=i, value=h)
        c.font = f(10, True)
        c.fill = HEAD_FILL
        c.border = BOX
        c.alignment = WRAP
    kind_dv = DataValidation(type="list", formula1='"Blocker,Annoying,Idea"', allow_blank=True)
    np_.add_data_validation(kind_dv)
    for i in range(3, 23):
        for j in range(1, 5):
            c = np_.cell(row=i, column=j)
            c.border = BOX
            c.fill = INPUT_FILL
            c.font = f(10)
            c.alignment = WRAP
        kind_dv.add(np_.cell(row=i, column=3))
        np_.row_dimensions[i].height = 24
    np_["A25"] = "My score, from 1 (I wouldn't trust it) to 5 (I'd use it next season):"
    np_["A25"].font = f(10, True)
    np_.merge_cells("A25:C25")
    np_["D25"].fill = INPUT_FILL
    np_["D25"].border = BOX
    np_["A27"] = "The three most confusing moments:"
    np_["A27"].font = f(10, True)
    for i, r in enumerate(range(28, 31), start=1):
        np_[f"A{r}"] = f"{i}."
        np_[f"A{r}"].font = f(10)
        np_.merge_cells(f"B{r}:D{r}")
        np_[f"B{r}"].fill = INPUT_FILL
        np_[f"B{r}"].border = BOX
    np_["A32"] = "One thing that worked well:"
    np_["A32"].font = f(10, True)
    np_.merge_cells("B33:D33")
    np_["B33"].fill = INPUT_FILL
    np_["B33"].border = BOX

    for title, sheet_intro, headers, widths, rows in (extra_sheets or []):
        ws = wb.create_sheet(title, index=wb.sheetnames.index("Script") + 1)
        ws.sheet_view.showGridLines = False
        ws["A1"] = title
        ws["A1"].font = f(14, True, GREEN)
        ws["A2"] = sheet_intro
        ws["A2"].font = f(10)
        ws["A2"].alignment = WRAP
        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(headers))
        ws.row_dimensions[2].height = 45
        for i, (h, w) in enumerate(zip(headers, widths), start=1):
            c = ws.cell(row=4, column=i, value=h)
            c.font = f(10, True)
            c.fill = HEAD_FILL
            c.border = BOX
            c.alignment = WRAP
            ws.column_dimensions[c.column_letter].width = w
        for r, values in enumerate(rows, start=5):
            for i, v in enumerate(values, start=1):
                c = ws.cell(row=r, column=i, value=v)
                c.font = f(10, i == 1)
                c.alignment = WRAP
                c.border = BOX
                if v in ("Yes",):
                    c.fill = PatternFill("solid", fgColor="E3EFE5")
                elif v in ("No",):
                    c.fill = PatternFill("solid", fgColor="F8E1E1")
        ws.freeze_panes = "B5"

    for ws in wb.worksheets:
        ws.sheet_properties.tabColor = GREEN if ws.title == "Script" else "8FBC8F"

    from openpyxl.workbook.properties import CalcProperties
    wb.calculation = CalcProperties(fullCalcOnLoad=True)
    wb.save(out)
    print("saved", out, "script rows to", last_script_row)
