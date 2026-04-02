"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MathJaxPTSansFont = void 0;
var FontData_js_1 = require("@mathjax/src/cjs/output/svg/FontData.js");
var common_js_1 = require("./common.js");
var normal_js_1 = require("./svg/normal.js");
var bold_js_1 = require("./svg/bold.js");
var italic_js_1 = require("./svg/italic.js");
var bold_italic_js_1 = require("./svg/bold-italic.js");
var monospace_js_1 = require("./svg/monospace.js");
var smallop_js_1 = require("./svg/smallop.js");
var largeop_js_1 = require("./svg/largeop.js");
var size3_js_1 = require("./svg/size3.js");
var size4_js_1 = require("./svg/size4.js");
var size5_js_1 = require("./svg/size5.js");
var size6_js_1 = require("./svg/size6.js");
var size7_js_1 = require("./svg/size7.js");
var size8_js_1 = require("./svg/size8.js");
var size9_js_1 = require("./svg/size9.js");
var size10_js_1 = require("./svg/size10.js");
var size11_js_1 = require("./svg/size11.js");
var size12_js_1 = require("./svg/size12.js");
var size13_js_1 = require("./svg/size13.js");
var size14_js_1 = require("./svg/size14.js");
var size15_js_1 = require("./svg/size15.js");
var lf_tp_js_1 = require("./svg/lf-tp.js");
var rt_bt_js_1 = require("./svg/rt-bt.js");
var ext_js_1 = require("./svg/ext.js");
var mid_js_1 = require("./svg/mid.js");
var up_js_1 = require("./svg/up.js");
var dup_js_1 = require("./svg/dup.js");
var delimiters_js_1 = require("./svg/delimiters.js");
var Base = (0, common_js_1.CommonMathJaxPTSansFontMixin)(FontData_js_1.SvgFontData);
var MathJaxPTSansFont = (function (_super) {
    __extends(MathJaxPTSansFont, _super);
    function MathJaxPTSansFont(options) {
        var e_1, _a;
        if (options === void 0) { options = {}; }
        var _this = _super.call(this, options) || this;
        var CLASS = _this.constructor;
        try {
            for (var _b = __values(Object.keys(_this.variant)), _c = _b.next(); !_c.done; _c = _b.next()) {
                var variant = _c.value;
                _this.variant[variant].cacheID = 'PTSA-' + (CLASS.variantCacheIds[variant] || 'N');
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
            }
            finally { if (e_1) throw e_1.error; }
        }
        return _this;
    }
    MathJaxPTSansFont.NAME = 'MathJaxPTSans';
    MathJaxPTSansFont.OPTIONS = __assign(__assign({}, Base.OPTIONS), { dynamicPrefix: '@mathjax/mathjax-ptsans-font/js/svg/dynamic' });
    MathJaxPTSansFont.defaultDelimiters = delimiters_js_1.delimiters;
    MathJaxPTSansFont.defaultChars = {
        'normal': normal_js_1.normal,
        'bold': bold_js_1.bold,
        'italic': italic_js_1.italic,
        'bold-italic': bold_italic_js_1.boldItalic,
        'monospace': monospace_js_1.monospace,
        '-smallop': smallop_js_1.smallop,
        '-largeop': largeop_js_1.largeop,
        '-size3': size3_js_1.size3,
        '-size4': size4_js_1.size4,
        '-size5': size5_js_1.size5,
        '-size6': size6_js_1.size6,
        '-size7': size7_js_1.size7,
        '-size8': size8_js_1.size8,
        '-size9': size9_js_1.size9,
        '-size10': size10_js_1.size10,
        '-size11': size11_js_1.size11,
        '-size12': size12_js_1.size12,
        '-size13': size13_js_1.size13,
        '-size14': size14_js_1.size14,
        '-size15': size15_js_1.size15,
        '-lf-tp': lf_tp_js_1.lfTp,
        '-rt-bt': rt_bt_js_1.rtBt,
        '-ext': ext_js_1.ext,
        '-mid': mid_js_1.mid,
        '-up': up_js_1.up,
        '-dup': dup_js_1.dup
    };
    MathJaxPTSansFont.variantCacheIds = {
        'normal': 'N',
        'bold': 'B',
        'italic': 'I',
        'bold-italic': 'BI',
        'monospace': 'M',
        '-smallop': 'SO',
        '-largeop': 'LO',
        '-size3': 'S3',
        '-size4': 'S4',
        '-size5': 'S5',
        '-size6': 'S6',
        '-size7': 'S7',
        '-size8': 'S8',
        '-size9': 'S9',
        '-size10': 'S10',
        '-size11': 'S11',
        '-size12': 'S12',
        '-size13': 'S13',
        '-size14': 'S14',
        '-size15': 'S15',
        '-lf-tp': 'LT',
        '-rt-bt': 'RB',
        '-ext': 'E',
        '-mid': 'MD',
        '-up': 'U',
        '-dup': 'D'
    };
    return MathJaxPTSansFont;
}(Base));
exports.MathJaxPTSansFont = MathJaxPTSansFont;
