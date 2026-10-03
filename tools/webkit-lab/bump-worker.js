onmessage = event => {
  const { name, version } = event.data;
  const request = indexedDB.open(name, version);
  request.onblocked = () => postMessage('blocked');
  request.onupgradeneeded = () => postMessage('upgrade');
  request.onsuccess = () => { request.result.close(); postMessage('success'); };
  request.onerror = () => postMessage('error:' + String(request.error));
};
