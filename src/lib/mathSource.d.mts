type TypesetMathElement = { typesetMath?: boolean; html?: string } | null | undefined;
type TypesetMathConfig = { typesetMath?: boolean } | null | undefined;

/** Whether a text element's $..$ and $$..$$ are typeset: the element's own value,
 *  else the deck's, else true (decks made before the setting existed). */
export function effectiveTypesetMath(element: TypesetMathElement, config: TypesetMathConfig): boolean;

/** The html a math finder should see: literal dollars (an escaped \$, or every dollar
 *  when typesetting is off) become &#36;. Dollars inside tags are untouched. */
export function mathSourceHtml(html: string | null | undefined, typeset: boolean): string;

/** mathSourceHtml for a text element, with its setting resolved against the deck. */
export function elementMathHtml(element: TypesetMathElement, config: TypesetMathConfig): string;

/** Plain-text counterpart (alt text, clipboard text): \$ becomes a plain "$". */
export function mathSourcePlain(text: string | null | undefined): string;
