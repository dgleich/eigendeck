#!/usr/bin/env python3
# Fixture for the manifest-SCOPED egress e2e (docs/CSP-AND-EGRESS.md §2b). Internet
# stays ON (the probe does NOT flip the master switch). The notebook output DECLARES
# a manifest for "allowed.example" and then fetches two hosts: the declared one and
# an UNdeclared one. It reports which fetches tripped a connect-src CSP violation.
# Expectation: only the undeclared host is blocked; the declared host is allowed by
# the injected scoped connect-src (network still fails, but no CSP violation).
import base64, json, sys

PAYLOAD = (
    '<script type="application/eigendeck-manifest+json">'
    '{"network":[{"host":"allowed.example","purpose":"probe"}]}'
    '</script>'
    # remote <script src>: the declared host is allowed by script-src, the undeclared
    # one must trip a script-src violation (CSP rejects it before any network request,
    # so this holds even with no network in the rig). "No internet means no internet."
    '<script src="https://allowed.example/lib.js"></script>'
    '<script src="https://blocked.example/evil.js"></script>'
    '<div id="p">plot</div><script>'
    '(function(){'
    'function rep(o){try{parent.postMessage(Object.assign({__netprobe:1},o),"*");}catch(e){}}'
    'var viol=[];'
    'document.addEventListener("securitypolicyviolation",function(e){'
    'viol.push({d:String(e.violatedDirective||""),u:String(e.blockedURI||"")});});'
    'function f(u){try{fetch(u).then(function(){},function(){});}catch(e){}}'
    'f("https://allowed.example/x");'
    'f("https://blocked.example/y");'
    'function send(){rep({viol:viol.slice()});}'
    'window.addEventListener("load",send);[150,500,1000,1500].forEach(function(ms){setTimeout(send,ms);});'
    '})();'
    '</script>'
)

ipynb = {
    "cells": [
        {"cell_type": "code", "source": ["plot()\n"], "execution_count": 1, "metadata": {},
         "outputs": [{"output_type": "display_data", "data": {"text/html": [PAYLOAD]}, "metadata": {}}]},
    ],
    "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3"},
                 "language_info": {"name": "python"}},
    "nbformat": 4, "nbformat_minor": 5,
}

deck = {
    "title": "netmanifest", "theme": "white", "config": {},
    "slides": [
        {"id": "s0", "elements": []},
        {"id": "s1", "elements": [
            {"id": "nb1", "type": "notebook", "assetId": "ip1",
             "position": {"x": 40, "y": 40, "width": 1000, "height": 500}}]},
    ],
    "assets": [{"assetId": "ip1", "mime": "application/x-ipynb+json", "path": "nb.ipynb",
                "data": base64.b64encode(json.dumps(ipynb).encode()).decode()}],
}
json.dump(deck, open(sys.argv[1], "w")); print("wrote", sys.argv[1])
