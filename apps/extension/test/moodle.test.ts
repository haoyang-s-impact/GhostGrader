// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parseGradingPage, parseMark, toCommentHtml } from "../src/content/moodle";

const HTML = `
<div class="breadcrumb"><a href="http://localhost:8080/course/view.php?id=17">ENG8</a></div>
<a href="http://localhost:8080/course/view.php?id=17">8. Sınıf İngilizce (E8)</a>
<h1>Unit 1–2 Assessment</h1>
<h2>Grading question 1: Q1 – Comparing countries (E8.1.W1)</h2>
<form class="mform"><input type="hidden" name="id" value="157"><input type="hidden" name="qid" value="172"><input type="hidden" name="slot" value="1">
<select><option value="needsgrading" selected>Those that need grading (24)</option></select></form>
<form id="manualgradingform">
  <input type="hidden" name="qubaids" value="78,59">
  <h4>Attempt number 1 for Fatma Kaya (fatma.kaya@example.com)</h4>
  <div id="question-78-1" class="que essay manualgraded complete"><div class="content">
    <div class="formulation"><div class="qtext"><p><strong>Outcome:</strong> comparisons</p><table><thead><tr><th>Country</th><th>Weather</th></tr></thead><tbody><tr><td>New Zealand</td><td>Up to 45 °C</td></tr><tr><td>Canada</td><td>Up to 25 °C</td></tr></tbody></table><p>Look at the table. Compare the countries.</p></div><div class="qtype_essay_response readonly"><p>Canada colder than New Zealand.</p></div></div>
    <div class="comment"><div class="graderinfo"><h5>Rubric 1 (10 points)</h5><p><strong>Score 10:</strong> both.<br>Examples: <em>NZ is hotter.</em></p><p><strong>Score 5:</strong> one.</p><p><strong>Score 0:</strong> none.</p></div>
      <textarea name="q78:1_-comment" id="q78:1_-comment_id"></textarea>
      <input type="text" name="q78:1_-mark" value=""><input type="hidden" name="q78:1_-maxmark" value="10">
    </div></div></div>
  <h4>Attempt number 2 for Zeynep Kara (zeynep.kara2@example.com)</h4>
  <div id="question-59-1" class="que essay manualgraded complete"><div class="content">
    <div class="formulation"><div class="qtext">Look at the table. Compare the countries.</div><div class="qtype_essay_response readonly">New Zealand is hotter than Canada.</div></div>
    <div class="comment"><textarea name="q59:1_-comment" id="q59:1_-comment_id"></textarea><input type="text" name="q59:1_-mark" value="5"><input type="hidden" name="q59:1_-maxmark" value="10"></div></div></div>
  <input type="submit" value="Save and show next">
</form>`;

describe("parseGradingPage", () => {
  document.body.innerHTML = HTML;
  const page = parseGradingPage(document)!;

  it("reads the page context", () => {
    expect(page.context).toMatchObject({
      courseLmsId: "17",
      courseName: "8. Sınıf İngilizce (E8)",
      quizLmsId: "157",
      quizName: "Unit 1–2 Assessment",
      questionLmsId: "172",
      slot: 1,
      questionTitle: "Q1 – Comparing countries (E8.1.W1)",
      maxMark: 10,
      attemptsTotal: 24,
    });
    expect(page.context.graderInfo).toMatch(/^Rubric 1/);
    expect(page.context.graderInfo).toMatch(/Score 10: both\.\s*\nExamples: NZ is hotter\./);
    expect(page.context.questionText).toBe("Outcome: comparisons\n\nCountry | Weather\nNew Zealand | Up to 45 °C\nCanada | Up to 25 °C\n\nLook at the table. Compare the countries.");
  });

  it("reads every attempt with its student, answer, mark input and editor id", () => {
    expect(page.attempts.map((a) => [a.lmsId, a.attemptNumber, a.studentName, a.studentEmail])).toEqual([
      ["78:1", 1, "Fatma Kaya", "fatma.kaya@example.com"],
      ["59:1", 2, "Zeynep Kara", "zeynep.kara2@example.com"],
    ]);
    expect(page.attempts[0]!.text).toBe("Canada colder than New Zealand.");
    expect(page.attempts[0]!.markInput.name).toBe("q78:1_-mark");
    expect(page.attempts[0]!.commentEditorId).toBe("q78:1_-comment_id");
    expect(page.attempts[1]!.markInput.value).toBe("5");
    expect(page.submitButton).not.toBeNull();
  });
});

describe("helpers", () => {
  it("parses marks with commas and blanks", () => {
    expect(parseMark("7,5")).toBe(7.5);
    expect(parseMark(" ")).toBeNull();
    expect(parseMark("x")).toBeNull();
  });
  it("escapes feedback into paragraph HTML", () => {
    expect(toCommentHtml("Good <work>.\nNext: more.")).toBe("<p>Good &lt;work&gt;.<br>Next: more.</p>");
  });
});
