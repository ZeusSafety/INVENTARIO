/**
 * Módulo de Vista Comparar
 * 
 * Contiene toda la lógica relacionada con la comparación de inventarios.
 */

import { AppState, cmpFiltroTxt, cmpEstado, setCmpFiltroTxt, setCmpEstado as setCmpEstadoState } from '../state.js';
import { $, fmt12, debounce } from '../utils.js';
import { cargarDatosFisicosDesdeAPI } from '../api/inventario.js';
import { renderConsolidado } from './consolidado.js';

// Variable global para almacenar el almacén seleccionado en el modal
export let almacenModalSistema = null;

/**
 * Cargar y comparar inventario para un almacén
 */
export async function cargarYComparar(almacen) {
  console.log('Cargando y comparando para:', almacen);
  
  // Verificar que hay datos del sistema (Excel) cargados
  if (!AppState.sistema[almacen] || AppState.sistema[almacen].length === 0) {
    alert(`No hay datos del sistema cargados para ${almacen}.\n\nDebe adjuntar un archivo Excel primero usando el botón "Subir Sistema ${almacen.toUpperCase()}".`);
    return;
  }
  
  // Mostrar indicador de carga
  const btn = document.getElementById(almacen === 'callao' ? 'btn-alm-callao' : 'btn-alm-malvinas');
  const originalText = btn.innerHTML;
  btn.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> Cargando...`;
  btn.disabled = true;
  
  try {
    // Abrir comparación
    await abrirComparacion(almacen);
    toast(`Comparación abierta para ${almacen}`, 'success');
  } catch (error) {
    console.error('Error en cargarYComparar:', error);
    alert(`Error: ${error.message}`);
  } finally {
    // Restaurar botón
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

/**
 * Abrir comparación para un almacén
 */
export async function abrirComparacion(almacen) {
  console.log('Abriendo comparación para:', almacen);
  
  // 1. Verificar que hay inventario activo
  if (!AppState.sesionActual?.numero) {
    alert('No hay inventario activo. Debe unirse a un inventario primero.');
    return;
  }
  
  // 2. Verificar si ya tenemos datos del sistema cargados
  if (!AppState.sistema[almacen] || AppState.sistema[almacen].length === 0) {
    // Intentar cargar desde la API si no hay datos locales
    if (AppState.sesionActual?.inventarioId) {
      console.log('No hay datos locales, intentando cargar desde la API...');
      try {
        const api = "https://inventario-2946605267.us-central1.run.app";
        const method = "stock_sistema_excel";
        const idTipoAlmacen = almacen === 'callao' ? '2' : '1';
        const id = `${AppState.sesionActual.inventarioId}-${idTipoAlmacen}`;
        
        const response = await fetch(`${api}?method=${method}&id=${encodeURIComponent(id)}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });

        if (response.status === 200) {
          const data = await response.json();
          if (Array.isArray(data) && data.length > 0) {
            AppState.sistema[almacen] = data.map((item, index) => ({
              item: index + 1,
              producto: item.PRODUCTO || '',
              codigo: item.CODIGO || '',
              cantidad_sistema: Number(item.CANTIDAD) || 0
            })).filter(x => x.codigo);
            
            console.log('Datos cargados desde API:', AppState.sistema[almacen].length, 'productos');
            toast(`Datos del sistema cargados desde la base de datos: ${AppState.sistema[almacen].length} productos`, 'success');
          } else {
            alert('No hay datos del sistema cargados. Debe adjuntar un archivo Excel primero usando el botón "Subir Sistema".');
            return;
          }
        } else {
          alert('No hay datos del sistema cargados. Debe adjuntar un archivo Excel primero usando el botón "Subir Sistema".');
          return;
        }
      } catch (apiError) {
        console.error('Error cargando desde API:', apiError);
        alert('No hay datos del sistema cargados. Debe adjuntar un archivo Excel primero usando el botón "Subir Sistema".');
        return;
      }
    } else {
      alert('No hay datos del sistema cargados. Debe adjuntar un archivo Excel primero usando el botón "Subir Sistema".');
      return;
    }
  }
  
  // 3. Cargar datos físicos desde API
  console.log('Cargando datos físicos desde API para:', almacen);
  
  let datosFisicos = [];
  try {
    datosFisicos = await cargarDatosFisicosDesdeAPI(almacen);
    console.log('Datos físicos cargados:', datosFisicos.length, 'productos');
  } catch (error) {
    console.error('Error cargando datos físicos:', error);
    alert('Error al cargar datos físicos desde la API. Intente nuevamente.');
    return;
  }
  
  if (datosFisicos.length === 0) {
    alert('No hay datos físicos registrados para comparar.');
    return;
  }
  
  if ((AppState.sistema[almacen] || []).length === 0) {
    alert('No hay datos del sistema cargados.');
    return;
  }
  
  $('cmp-almacen').textContent = almacen.toUpperCase();
  $('cmp-numero').textContent = AppState.sesionActual.numero;
  $('cmp-fecha').textContent = fmt12();
  
  // Crear mapas para comparación
  const mapSis = new Map((AppState.sistema[almacen] || []).map(s => [s.codigo, s]));
  const mapFis = new Map(datosFisicos.map(f => [f.codigo, f]));
  
  const codigos = new Set([...mapSis.keys(), ...mapFis.keys()]);
  
  const filas = [];
  codigos.forEach(c => {
    const s = mapSis.get(c);
    const f = mapFis.get(c);
    const prod = (f?.producto) || (s?.producto) || '';
    const item = (f?.item) || (s?.item) || '';
    const sis = Number(s?.cantidad_sistema || 0);
    const fis = Number(f?.cantidad_fisica || 0);
    const res = fis - sis;
    const estado = res === 0 ? 'CONFORME' : (res > 0 ? 'SOBRANTE' : 'FALTANTE');
    filas.push({ item, producto: prod, codigo: c, sis, fis, res, estado });
  });
  
  AppState.comparacion = { almacen, filas };
  pintarComparacion();
  renderConsolidado();
  $('panel-comparacion')?.classList.remove('invis');
  
  try {
    document.querySelectorAll('#btn-alm-callao, #btn-alm-malvinas').forEach(b => b.classList.remove('active-alm'));
    const selBtn = document.getElementById(almacen === 'callao' ? 'btn-alm-callao' : 'btn-alm-malvinas');
    selBtn?.classList.add('active-alm');
  } catch (e) {}
  
  try {
    const inp = document.getElementById('cmp-search');
    if (inp) {
      inp.value = '';
      inp.classList.remove('filter-active');
    }
    setCmpFiltroTxt('');
    setCmpEstado('ALL');
  } catch (e) {}
}

/**
 * Pintar tabla de comparación
 */
export function pintarComparacion() {
  const tb = $('tbl-comparacion')?.querySelector('tbody');
  if (!tb) return;
  
  tb.innerHTML = '';
  let ok = 0, bad = 0;
  const soloSis = !!document.getElementById('cmp-solo-sistema')?.checked;
  const setSis = new Set(((AppState.sistema[AppState.comparacion?.almacen] || [])).map(s => s.codigo));
  
  (AppState.comparacion?.filas || []).forEach(r => {
    if (soloSis && !setSis.has(r.codigo)) return;
    if (cmpFiltroTxt) {
      const code = String(r.codigo || '').toLowerCase();
      const prod = String(r.producto || '').toLowerCase();
      if (!code.includes(cmpFiltroTxt) && !prod.includes(cmpFiltroTxt)) return;
    }
    if (cmpEstado === 'OK' && r.res !== 0) return;
    if (cmpEstado === 'BAD' && r.res === 0) return;
    
    if (r.res === 0) ok++;
    else bad++;
    
    const resTxt = r.res > 0 ? `+${r.res}` : (r.res < 0 ? `${r.res}` : '0');
    const estCls = r.estado === 'CONFORME' ? 'text-bg-success' :
      (r.estado === 'FALTANTE' ? 'text-bg-danger' : 'text-bg-warning');
    const resCls = estCls;
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.item}</td>
      <td>${r.producto}</td>
      <td>${r.codigo}</td>
      <td class="text-center">${r.sis}</td>
      <td class="text-center">${r.fis}</td>
      <td class="text-center"><span class="badge ${resCls}">${resTxt}</span></td>
      <td><span class="badge ${estCls}">${r.estado}</span></td>
      <td>
        <div class="position-relative d-inline-block" data-codigo="${r.codigo}">
          <button class="btn btn-sm btn-edit" onclick="abrirMenuEditar(event,'${r.codigo}')">
            Editar <i class="bi bi-caret-down-fill ms-1"></i>
          </button>
          <div class="mini-menu d-none">
            <button class="mm-item" onclick="accionEditarCantidadDesdeMenu(event,this)">Editar Cantidad</button>
            <button class="mm-item" onclick="accionEditarSistemaDesdeMenu(event,this)">Editar Sistema</button>
            <button class="mm-item" onclick="accionEditarVerificacionDesdeMenu(event,this)">Editar Verificación</button>
          </div>
        </div>
      </td>`;
    tb.appendChild(tr);
  });
  
  $('cmp-correctos').textContent = ok;
  $('cmp-incorrectos').textContent = bad;
}

/**
 * Establecer estado de comparación (OK/BAD/ALL)
 */
export function setCmpEstado(next) {
  setCmpEstadoState(next); // Llamar a la función del state
  const ok = document.getElementById('cmp-badge-ok');
  const bad = document.getElementById('cmp-badge-bad');
  ok?.classList.toggle('border', next === 'OK');
  bad?.classList.toggle('border', next === 'BAD');
  try {
    pintarComparacion();
    renderConsolidado();
  } catch (e) {}
}

/**
 * Mostrar todos los resultados de comparación
 */
export function cmpMostrarTodos() {
  setCmpEstadoState('ALL');
  setCmpFiltroTxt('');
  const inp = document.getElementById('cmp-search');
  if (inp) {
    inp.value = '';
    inp.classList.remove('filter-active');
  }
  const ok = document.getElementById('cmp-badge-ok');
  const bad = document.getElementById('cmp-badge-bad');
  ok?.classList.remove('border');
  bad?.classList.remove('border');
  try {
    pintarComparacion();
    renderConsolidado();
  } catch (e) {}
}

/**
 * Construir sugerencias de búsqueda
 */
export function buildCmpSugerencias(q) {
  const arr = (AppState.comparacion?.filas) || [];
  const s = (q || '').toLowerCase();
  const out = [];
  const seen = new Set();
  
  arr.forEach(r => {
    [String(r.codigo || ''), String(r.producto || '')].forEach(v => {
      const vv = v.trim();
      if (vv && vv.toLowerCase().includes(s) && !seen.has(vv)) {
        seen.add(vv);
        out.push(vv);
      }
    });
  });
  
  return out.slice(0, 10);
}

/**
 * Mostrar sugerencias de búsqueda
 */
export function showCmpSugerencias() {
  const box = document.getElementById('cmp-suggest');
  const inp = document.getElementById('cmp-search');
  if (!box || !inp) return;
  
  const q = (inp.value || '').trim();
  if (!q) {
    box.classList.add('d-none');
    box.innerHTML = '';
    return;
  }
  
  const items = buildCmpSugerencias(q);
  if (items.length === 0) {
    box.classList.add('d-none');
    box.innerHTML = '';
    return;
  }
  
  box.innerHTML = items.map(v => `<div class="item" data-v="${v.replace(/"/g, '&quot;')}">${v}</div>`).join('');
  box.classList.remove('d-none');
  
  box.querySelectorAll('.item').forEach(el => {
    el.addEventListener('click', () => {
      const v = el.getAttribute('data-v') || '';
      inp.value = v;
      setCmpFiltroTxt(v.toLowerCase());
      inp.classList.add('filter-active');
      box.classList.add('d-none');
      try {
        pintarComparacion();
        renderConsolidado();
      } catch (e) {}
    });
  });
}

// Debounce para búsqueda
export const debounceCmp = debounce(showCmpSugerencias, 300);

// Exportar funciones para uso global (temporal hasta que se cree main.js)
window.cargarYComparar = cargarYComparar;
window.abrirComparacion = abrirComparacion;
window.pintarComparacion = pintarComparacion;
window.setCmpEstado = setCmpEstado;
window.cmpMostrarTodos = cmpMostrarTodos;
window.showCmpSugerencias = showCmpSugerencias;
window.debounceCmp = debounceCmp;

// Nota: Las siguientes funciones se moverán a components/modals.js en Fase 4:
// - abrirModalSistemaExcel
// - abrirInputExcel
// - extraerConteosGuardados
// - cargarSistema
// - abrirMenuEditar
// - accionEditarCantidadDesdeMenu
// - accionEditarSistemaDesdeMenu
// - accionEditarVerificacionDesdeMenu
// - exportComparacionPDF
// - exportComparacionExcel

