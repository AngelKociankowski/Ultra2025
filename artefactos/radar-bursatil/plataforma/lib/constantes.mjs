// Constantes de la plataforma (12-plan §5.1). Todo congelado.
const congelar = o => {
  if (o && typeof o === "object") { Object.values(o).forEach(congelar); Object.freeze(o); }
  return o;
};

export const DEV = "drutina0001";
export const COLECCION = "data/users/me";
// Las 9 categorías del contador de la página (data.js CATS)
export const CATS = congelar(["sonda", "arranque", "franja", "tabla", "mercado", "macro", "corrida", "detalle", "manual"]);
export const DOC_MAX = 150000;
export const FMP_POR_MIN = 200;
export const ET_ZONA = "America/New_York";
export const VERSION = "1.0.0";

// §5.11.5: dominios fidedignos (registrables). gob.mx solo con ruta /shcp (se valida en noticias.mjs).
export const DOMINIOS = congelar([
  "reuters.com", "apnews.com", "bloomberg.com", "wsj.com", "ft.com", "cnbc.com", "marketwatch.com", "barrons.com",
  "federalreserve.gov", "bls.gov", "bea.gov", "treasury.gov", "sec.gov", "banxico.org.mx", "inegi.org.mx", "gob.mx",
]);
export const CATEGORIAS_EVENTO = congelar(["fraude", "quiebra", "suspension", "deslistado", "fusion_pendiente", "recorte_guia"]);

// §5.9.6: rutina-config (sin kind/v/at, que pone quien escribe el documento)
export const CONFIG_DEFECTO = congelar({
  operar: false, perfil: "moderado", bandaPts: 5, minOrdenUSD: 100, nuevoSatelitePct: 3, diasSalida: 3, maxOrdenesDia: 12,
  ventanaET: { desde: "09:45", hasta: "15:30" }, noticiasVentanaH: 72, tolPrecioPct: 2, activadoEl: null, podar: true,
});
export const CONFIG_RANGOS = congelar({
  bandaPts: [2, 15], minOrdenUSD: [50, 1000], nuevoSatelitePct: [1, 10], diasSalida: [1, 10], maxOrdenesDia: [1, 20],
  ventanaDesde: ["09:35", "11:00"], ventanaHasta: ["12:00", "15:45"], noticiasVentanaH: [24, 168], tolPrecioPct: [0.5, 5],
  perfil: ["conservador", "moderado", "agresivo"],
});
