type RenderInvalidOptions = { readonly root: HTMLElement; readonly hint?: string };

export const renderInvalid = ({ root, hint = "Ask the head judge for a new one." }: RenderInvalidOptions): void => {
  root.innerHTML = `
    <main class="main judge-invalid">
      <h1>This link isn't valid</h1>
      <p>${hint}</p>
    </main>`;
};
