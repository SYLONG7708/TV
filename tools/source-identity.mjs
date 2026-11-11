export function sourceIdentityKey(source,normalizeApi=value=>String(value||'').trim()){
  const api=normalizeApi(source.api);
  if(Number(source.type)!==3&&!source.adapterKind)return api;
  return `${api}|${JSON.stringify(source.configRef||source.ext||'')}`;
}
