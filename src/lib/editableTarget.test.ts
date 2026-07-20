import { describe, it, expect, beforeEach } from 'vitest';
import { isEditableNode, eventInTextEditor, type EditorFocusDoc } from './editableTarget';

function build() {
  document.body.innerHTML = `
    <div id="canvas">
      <div id="editable" contenteditable="true"><span id="run">hello</span></div>
    </div>
    <input id="inp" />
    <textarea id="ta"></textarea>
  `;
  return {
    body: document.body,
    canvas: document.getElementById('canvas')!,
    editable: document.getElementById('editable')!,
    run: document.getElementById('run')!,
    textNode: document.getElementById('run')!.firstChild!, // the "hello" text node
    input: document.getElementById('inp')!,
    textarea: document.getElementById('ta')!,
  };
}

describe('isEditableNode', () => {
  let d: ReturnType<typeof build>;
  beforeEach(() => { d = build(); });

  it('true for the contentEditable host, a descendant element, and a descendant text node', () => {
    expect(isEditableNode(d.editable)).toBe(true);
    expect(isEditableNode(d.run)).toBe(true);
    expect(isEditableNode(d.textNode)).toBe(true); // text node → parent element → closest
  });
  it('true for input/textarea', () => {
    expect(isEditableNode(d.input)).toBe(true);
    expect(isEditableNode(d.textarea)).toBe(true);
  });
  it('false for the canvas, the body, and null', () => {
    expect(isEditableNode(d.canvas)).toBe(false);
    expect(isEditableNode(d.body)).toBe(false);
    expect(isEditableNode(null)).toBe(false);
    expect(isEditableNode(undefined)).toBe(false);
  });
});

describe('eventInTextEditor — robust to WebKit mis-targeting', () => {
  let d: ReturnType<typeof build>;
  beforeEach(() => { d = build(); });

  it('true when the event target is the editable (the normal case)', () => {
    expect(eventInTextEditor({ target: d.editable }, { activeElement: d.body })).toBe(true);
  });

  it('THE BUG: target is <body> but FOCUS is in the editable → still true (bail)', () => {
    // WebKit dispatched the keyboard paste with target=body; without the
    // activeElement check this returned false and the canvas handler double-pasted.
    const doc: EditorFocusDoc = { activeElement: d.editable };
    expect(eventInTextEditor({ target: d.body }, doc)).toBe(true);
  });

  it('true when target is <body> but the SELECTION anchor is inside the editable', () => {
    const doc: EditorFocusDoc = {
      activeElement: d.body,
      getSelection: () => ({ focusNode: d.textNode }),
    };
    expect(eventInTextEditor({ target: d.body }, doc)).toBe(true);
  });

  it('false for a genuine canvas paste — target canvas, focus on body, no selection', () => {
    const doc: EditorFocusDoc = { activeElement: d.body, getSelection: () => null };
    expect(eventInTextEditor({ target: d.canvas }, doc)).toBe(false);
  });

  it('false when target is null and nothing is focused', () => {
    expect(eventInTextEditor({ target: null }, { activeElement: null })).toBe(false);
  });
});
