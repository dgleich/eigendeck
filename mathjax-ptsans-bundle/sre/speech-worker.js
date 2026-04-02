self.onmessage = function(e) { self.postMessage({id: e.data.id, result: ''}); };
self.postMessage({id: 'ready'});
