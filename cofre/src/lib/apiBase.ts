// Prefixo da API. Sozinho, o app vive na raiz e o prefixo é vazio; dentro do GuardList ele é
// construído com base /cofre/ e as chamadas vão para /cofre/api/v1.
export const API_BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');
