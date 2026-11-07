// Same key DesignerApp (designer-app.jsx) restores its state from on start.
export const EDITOR_STORAGE = "karkas.designer.v2";

export function openInEditor(project) {
  localStorage.setItem(EDITOR_STORAGE, JSON.stringify({ version: 2, project }));
  window.location.assign("/?mode=editor");
}

export function editorProject() {
  try {
    return JSON.parse(localStorage.getItem(EDITOR_STORAGE))?.project ?? null;
  } catch {
    return null;
  }
}
