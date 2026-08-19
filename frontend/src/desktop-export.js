export async function saveCsvToDesktop(input, browser = globalThis) {
  if (typeof browser.showSaveFilePicker !== 'function') {
    const link = browser.document?.createElement?.('a');
    if (!link) return null;
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(input.content)}`;
    link.download = input.filename;
    link.hidden = true;
    browser.document.body.append(link);
    link.click();
    link.remove();
    return {
      filename: input.filename,
      localPath: `电脑默认下载位置/${input.filename}`,
      destination: 'browser-download'
    };
  }
  const handle = await browser.showSaveFilePicker({
    suggestedName: input.filename,
    startIn: 'desktop',
    types: [{
      description: 'CSV 表格',
      accept: { 'text/csv': ['.csv'] }
    }]
  });
  const writable = await handle.createWritable();
  await writable.write(input.content);
  await writable.close();
  return {
    filename: handle.name,
    localPath: `桌面/${handle.name}`,
    destination: 'desktop'
  };
}
