import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BRIEF_TOPICS } from "../brief.ts";
import { pointEvidence } from "./point-evidence.ts";

const score = (point: string, title: string) => ({ point, title, score: 8, reason: `why ${point}`, pitch: `say ${point}`, watch_out: `careful ${point}` });
const brief = {
  points: {
    scores: [score("traction", "Traction"), score("backers", "Backers already in"), score("founder_fit", "Founder-market fit and track record"), score("why_now", "Why now")],
    chosen: ["founder_fit", "traction", "backers"],
    scored_at: null,
    confirmed_at: null,
  },
  sections: { team: "- Ana, CEO: ran a clinic group for 9 years [LinkedIn]", traction: "- 140 clinics pay monthly [deck, slide 6]", round: "" },
};

test("each narrative point gets its brief score and the sections behind it", () => {
  const [founder, traction] = pointEvidence(["Founder-market fit and track record", "Traction"], brief, DEFAULT_BRIEF_TOPICS);
  assert.equal(founder?.why, "why founder_fit");
  assert.equal(founder?.say, "say founder_fit");
  assert.equal(founder?.watchOut, "careful founder_fit");
  assert.equal(founder?.sections.length, 1);
  assert.match(founder?.sections[0].text ?? "", /\[LinkedIn\]/);
  assert.match(traction?.sections[0].text ?? "", /slide 6/);
});

test("a reworded title is matched by position; an empty section is left out", () => {
  const out = pointEvidence(["A founder who has done it", "Traction", "Backers Already In The Round"], brief, DEFAULT_BRIEF_TOPICS);
  assert.equal(out[0]?.why, "why founder_fit");
  assert.equal(out[2]?.why, "why backers");
  assert.deepEqual(out[2]?.sections, []);
});

test("no brief, or a point that can't be matched, gives nothing", () => {
  assert.deepEqual(pointEvidence(["Traction"], null, DEFAULT_BRIEF_TOPICS), [null]);
  // Two points against three chosen: position can't be trusted, the title must match.
  assert.deepEqual(pointEvidence(["Something else", "Traction"], brief, DEFAULT_BRIEF_TOPICS).map(Boolean), [false, true]);
});
