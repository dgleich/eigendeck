#!/usr/bin/env python3
# Fixture for the demo internet-block enforcement e2e. Notebook on slide 1 (slide 0
# empty) so the probe can flip the global "demoInternetAccess" pref OFF *before*
# the notebook mounts. The interactive output self-reports: is RTCPeerConnection
# gone (WebRTC neuter), and does a fetch trip a connect-src CSP violation (the
# injected connect-src 'none' lockdown). Reported via postMessage({__netprobe:1}).
import base64, json, sys

PAYLOAD = (
    '<div id="p">plot</div><script>'
    '(function(){'
    'function rep(o){try{parent.postMessage(Object.assign({__netprobe:1},o),"*");}catch(e){}}'
    'var rtc=(typeof RTCPeerConnection==="undefined")?"gone":"present";'
    'var csp=false;'
    'document.addEventListener("securitypolicyviolation",function(e){'
    'if(e.violatedDirective&&String(e.violatedDirective).indexOf("connect-src")>=0)csp=true;});'
    'try{fetch("https://example.com/probe").then(function(){},function(){});}catch(e){}'
    'function send(){rep({rtc:rtc,cspBlocked:csp});}'
    'window.addEventListener("load",send);[150,500,1000].forEach(function(ms){setTimeout(send,ms);});'
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
    "title": "netblock", "theme": "white", "config": {},
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
