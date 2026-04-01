import { Extension } from '@tiptap/core';
import '@tiptap/extension-text-style';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textFormatting: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
      setFontFamily: (family: string) => ReturnType;
      unsetFontFamily: () => ReturnType;
      setTextColor: (color: string) => ReturnType;
      unsetTextColor: () => ReturnType;
      setUppercase: () => ReturnType;
      unsetUppercase: () => ReturnType;
    };
  }
}

export const FontSize = Extension.create({
  name: 'textFormatting',

  addOptions() {
    return {
      types: ['textStyle'],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) =>
              element.style.fontSize?.replace(/['"]+/g, '') || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
          fontFamily: {
            default: null,
            parseHTML: (element) =>
              element.style.fontFamily?.replace(/['"]+/g, '') || null,
            renderHTML: (attributes) => {
              if (!attributes.fontFamily) return {};
              return { style: `font-family: ${attributes.fontFamily}` };
            },
          },
          color: {
            default: null,
            parseHTML: (element) => element.style.color || null,
            renderHTML: (attributes) => {
              if (!attributes.color) return {};
              return { style: `color: ${attributes.color}` };
            },
          },
          textTransform: {
            default: null,
            parseHTML: (element) => element.style.textTransform || null,
            renderHTML: (attributes) => {
              if (!attributes.textTransform) return {};
              let style = `text-transform: ${attributes.textTransform}`;
              if (attributes.textTransform === 'uppercase') {
                style += '; letter-spacing: 0.08em';
              }
              return { style };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (fontSize: string) =>
        ({ chain }) => {
          return chain().setMark('textStyle', { fontSize }).run();
        },
      unsetFontSize:
        () =>
        ({ chain }) => {
          return chain()
            .setMark('textStyle', { fontSize: null })
            .removeEmptyTextStyle()
            .run();
        },
      setFontFamily:
        (fontFamily: string) =>
        ({ chain }) => {
          return chain().setMark('textStyle', { fontFamily }).run();
        },
      unsetFontFamily:
        () =>
        ({ chain }) => {
          return chain()
            .setMark('textStyle', { fontFamily: null })
            .removeEmptyTextStyle()
            .run();
        },
      setTextColor:
        (color: string) =>
        ({ chain }) => {
          return chain().setMark('textStyle', { color }).run();
        },
      unsetTextColor:
        () =>
        ({ chain }) => {
          return chain()
            .setMark('textStyle', { color: null })
            .removeEmptyTextStyle()
            .run();
        },
      setUppercase:
        () =>
        ({ chain }) => {
          return chain()
            .setMark('textStyle', { textTransform: 'uppercase' })
            .run();
        },
      unsetUppercase:
        () =>
        ({ chain }) => {
          return chain()
            .setMark('textStyle', { textTransform: null })
            .removeEmptyTextStyle()
            .run();
        },
    };
  },
});
