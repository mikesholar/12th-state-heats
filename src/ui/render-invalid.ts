type RenderInvalidOptions = { readonly root: HTMLElement };

export const renderInvalid = ({ root }: RenderInvalidOptions): void => {
  root.innerHTML = `
    <main class="main judge-invalid">
      <h1>This link isn't valid</h1>
      <p>Ask the head judge for a new one.</p>
    </main>`;
};
