self.onmessage = (e) => {
  const { code, data } = e.data;
  try {
    const processF = new Function(`return ${code}`)();
    const results = processF(data);
    self.postMessage({ results });
  } catch (error: any) {
    self.postMessage({ error: error.message });
  }
};
