import { renderInvalid } from "./render-invalid";

describe("an unknown judge link", () => {
  it("tells the judge to get a new link from the head judge", () => {
    const root = document.createElement("div");

    renderInvalid({ root });

    expect(root.textContent).toContain("This link isn't valid");
    expect(root.textContent).toContain("head judge");
  });

  it("shows a custom hint when given one", () => {
    const root = document.createElement("div");

    renderInvalid({ root, hint: "Ask the organisers for the sign-up link." });

    expect(root.textContent).toContain("Ask the organisers for the sign-up link.");
    expect(root.textContent).not.toContain("head judge");
  });
});
