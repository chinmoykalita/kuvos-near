"""Writes samples/synthetic-discharge.pdf: a clearly fictional, text-based (digital) discharge
summary for demos. No real patient, clinician, hospital or medicine. Standard library only."""
from pathlib import Path

LINES = [
    ("Helvetica-Bold", 15, "SYNTHETIC DEMO DOCUMENT - NOT A REAL PATIENT OR PRESCRIPTION"),
    ("Helvetica", 10, "Made for the Kuvos NEAR demo. Every name, medicine and date below is fictional."),
    ("Helvetica-Bold", 13, "Riverbend Demo Clinic - Discharge Instructions"),
    ("Helvetica", 11, "Patient: Asha Demo    Date of discharge: 14 November 2026"),
    ("Helvetica-Bold", 12, "Medicines"),
    ("Helvetica", 11, "1. Tab Demoprolol 25 mg - one tablet twice daily after food for 30 days."),
    ("Helvetica", 11, "2. Cap Samplezole 20 mg - one capsule once daily before breakfast for 14 days."),
    ("Helvetica", 11, "3. Tab Mockacetamol 500 mg - one tablet when needed for pain (SOS), max 3 a day."),
    ("Helvetica-Bold", 12, "Exercise"),
    ("Helvetica", 11, "4. Walk slowly for 15 minutes twice daily for 21 days."),
    ("Helvetica", 11, "5. Ankle pumps: 10 repetitions, 3 sets, every morning for 14 days."),
    ("Helvetica-Bold", 12, "Restrictions"),
    ("Helvetica", 11, "6. Do not lift more than 5 kg for 6 weeks."),
    ("Helvetica-Bold", 12, "Follow-up"),
    ("Helvetica", 11, "7. Review appointment at Riverbend Demo Clinic on 28 November 2026 at 10:30 AM."),
    ("Helvetica", 10, "Dr. Demo Practitioner (fictional)"),
]


def escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def main() -> None:
    y, ops = 790, []
    for font, size, text in LINES:
        y -= size + (14 if font.endswith("Bold") else 8)
        ops.append(f"BT /{'F2' if font.endswith('Bold') else 'F1'} {size} Tf 50 {y} Td ({escape(text)}) Tj ET")
    stream = "\n".join(ops).encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
    ]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    path = Path(__file__).resolve().parent.parent / "samples" / "synthetic-discharge.pdf"
    path.write_bytes(bytes(out))
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
