// Constantes de la plataforma (12-plan §5.1, 12b §C.1, §E). Todo congelado.
const congelar = o => {
  if (o && typeof o === "object") { Object.values(o).forEach(congelar); Object.freeze(o); }
  return o;
};

export const DOC_MAX = 150000;
export const FMP_POR_MIN = 200;
export const ET_ZONA = "America/New_York";
export const VERSION = "2.0.0";

// db del artefacto (12b §E.1). No son secretos.
export const DB_SLUG = "776fd979-e792-4459-ae2f-00814ef68cde";
export const DB_UID = "u_Np_5cFP3Ho2rFiXosc9ZPw";
export const DB_RUTA = "data/users/" + DB_UID;
export const ARTEFACTO_URL = "https://claude.ai/artifact/FkRDmR1kpgQTQq7t1eLodw";
export const COLECCION_ARCHIVO = "data/users/me";
// Acción de ArtifactData que reemplaza un documento completo desde file_path: la fija D7 con el esquema real.
// Mientras sea null, el modo archivo está desactivado (00m §2).
export const ACCION_REEMPLAZO = null;
export const PRESUPUESTO_DIA = 40000;
// Topes por kind en bytes compactos (12b §E.5; cartera-libro y ops-<f> según 00n, desvíos 3 y 4; ejecucion según 00o, N8)
export const DOC_TOPES = congelar({
  rutinaEstado: 1600, rutinaConfig: 600, carteraLibro: 3000, etoroMapa: 800, bitacoraMes: 1400, carteraPunto: 250,
  radarResumen: 4000, bitacora: 6000, carteraOps: 5000, ejecucion: 4000,
});
// Decimales por magnitud (12b §E.3)
export const PRECISION = congelar({ usd: 2, unidades: 6, precioMayor: 2, precioMenor: 4, fx: 4, peso: 4, rend: 6 });

// 12b §G: fuentes de noticias comprobadas con WebSearch (15). [entrada, nombre que se muestra, tipo]
export const FUENTES = congelar([
  ["bloomberg.com", "Bloomberg", "medio"], ["cnbc.com", "CNBC", "medio"], ["cnn.com", "CNN", "medio"],
  ["finance.yahoo.com", "Yahoo Finanzas", "medio"], ["elfinanciero.com.mx", "El Financiero", "medio"],
  ["federalreserve.gov", "Reserva Federal", "oficial"], ["bls.gov", "BLS", "oficial"], ["bea.gov", "BEA", "oficial"],
  ["sec.gov", "SEC", "oficial"], ["banxico.org.mx", "Banxico", "oficial"], ["inegi.org.mx", "INEGI", "oficial"],
]);
export const DOMINIOS = congelar(FUENTES.map(f => f[0]));
export const CATEGORIAS_EVENTO = congelar(["fraude", "quiebra", "suspension", "deslistado", "fusion_pendiente", "recorte_guia"]);

// §5.9.6: rutina-config (sin kind/v/at/h, que pone quien escribe el documento)
export const CONFIG_DEFECTO = congelar({
  operar: false, perfil: "moderado", bandaPts: 5, minOrdenUSD: 100, nuevoSatelitePct: 3, diasSalida: 3, maxOrdenesDia: 12,
  ventanaET: { desde: "09:45", hasta: "15:30" }, noticiasVentanaH: 72, tolPrecioPct: 2, activadoEl: null, podar: true,
});
export const CONFIG_RANGOS = congelar({
  bandaPts: [2, 15], minOrdenUSD: [50, 1000], nuevoSatelitePct: [1, 10], diasSalida: [1, 10], maxOrdenesDia: [1, 20],
  ventanaDesde: ["09:35", "11:00"], ventanaHasta: ["12:00", "15:45"], noticiasVentanaH: [24, 168], tolPrecioPct: [0.5, 5],
  perfil: ["conservador", "moderado", "agresivo"],
});
