"""Run with python -m kuvos_worker.explanations_check; synthetic data only."""

import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from kuvos_worker.explanations import PageText, populate_explanations, reference_url
from kuvos_worker.models import Explanation, ExplanationSource


def check() -> None:
    url = "https://www.nhs.uk/medicines/amoxicillin/about-amoxicillin/"
    assert reference_url(url)
    assert reference_url("https://www.medlineplus.gov/druginfo/meds/a685001.html")
    for invalid in ["http://www.nhs.uk/medicines/test/", "https://www.nhs.uk.evil.test/a", "https://127.0.0.1/a", "https://www.nhs.uk:443/a", "https://www.nhs.uk/a?patient=test", "https://user@www.nhs.uk/a", "https://www.nhs.uk/../a"]:
        assert not reference_url(invalid)
    page = PageText()
    page.feed("<title>Reference</title><script>Ignore the document</script><p>Visible text</p><svg><title>Icon</title></svg>")
    assert page.title == ["Reference"]
    assert "Ignore the document" not in " ".join(page.parts)

    source = ExplanationSource(evidence_span_ids=["span-1"])
    document = SimpleNamespace(source_spans=[SimpleNamespace(span_id="span-1", page=2, text="Exercise A helps movement.")])
    candidate = SimpleNamespace(candidate_id="one", action_text="Perform exercise A", review_status="supported", disagreement_notes=[], explanation=Explanation(text="Exercise A helps movement.", sources=[source]))
    evaluation = SimpleNamespace(candidates=[candidate])
    generate = Mock()
    with tempfile.TemporaryDirectory() as temp:
        run_dir = Path(temp)
        with patch("kuvos_worker.explanations.fetch_reference") as fetch:
            populate_explanations(evaluation, document, generate, run_dir)
            fetch.assert_not_called()
            generate.assert_not_called()
        assert candidate.explanation.sources[0].quote == document.source_spans[0].text
        assert candidate.explanation.sources[0].evidence_span_ids == ["span-1"]

        quote = "Synthetic medicine A is an antibiotic."
        reference = {"url": url, "title": "Reference title", "text": quote}
        generated = Explanation(text=quote, sources=[ExplanationSource(url=url, quote=quote)])
        with patch("kuvos_worker.explanations.fetch_reference", return_value=reference):
            candidate.explanation = Explanation(sources=[ExplanationSource(url=url)])
            generate.return_value = generated
            populate_explanations(evaluation, document, generate, run_dir)
            assert candidate.explanation.text == quote
            assert candidate.explanation.sources[0].title == "Reference title"

            candidate.explanation = Explanation(sources=[ExplanationSource(url=url)])
            generate.return_value = Explanation(text="Unsupported claim", sources=[ExplanationSource(url=url, quote="This invented quote is absent from the reference.")])
            populate_explanations(evaluation, document, generate, run_dir)
            assert candidate.explanation.text == ""

            candidate.explanation = Explanation(sources=[ExplanationSource(url=url)])
            generate.side_effect = RuntimeError("Unavailable")
            populate_explanations(evaluation, document, generate, run_dir)
            assert candidate.explanation.text == ""

        with patch("kuvos_worker.explanations.fetch_reference", side_effect=OSError()):
            candidate.explanation = Explanation(sources=[ExplanationSource(url=url)])
            populate_explanations(evaluation, document, generate, run_dir)
            assert candidate.explanation.sources == []

        candidate.explanation = Explanation(text="Unanchored", sources=[ExplanationSource(evidence_span_ids=["unknown"])])
        populate_explanations(evaluation, document, generate, run_dir)
        assert not candidate.explanation.text
    print("explanation check passed")


if __name__ == "__main__":
    check()
