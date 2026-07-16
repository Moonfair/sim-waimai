/** 复制餐厅顾客页链接到剪贴板，返回是否成功。 */
export async function copyRestaurantLink(id: string): Promise<boolean> {
  const url = new URL(`${import.meta.env.BASE_URL}restaurant/${id}`, window.location.origin).toString();
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}
