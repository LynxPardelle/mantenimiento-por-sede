import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Inspection } from './maintenance.models';
import { MaintenanceStore } from './maintenance.store';

describe('Flujo de mantenimiento por sede', () => {
  let store: InstanceType<typeof MaintenanceStore>;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), MaintenanceStore],
    });
    store = TestBed.inject(MaintenanceStore);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  async function selectSite(id = 'north', pending: Inspection[] = []) {
    const load = store.selectSite({
      id,
      name: id,
      timeZone: 'America/Mexico_City',
      role: 'coordinator',
    });
    http.expectOne(`/api/v1/sites/${id}/assets`).flush({ items: [] });
    http
      .expectOne((request) => request.url === `/api/v1/sites/${id}/inspections`)
      .flush({ items: pending });
    await load;
  }

  function deferRefresh() {
    const load = store.refresh();
    const assets = http.expectOne('/api/v1/sites/north/assets');
    const pending = http.expectOne((request) => request.url === '/api/v1/sites/north/inspections');
    return { load, assets, pending };
  }

  it('conserva la clave de idempotencia después de un fallo de red y la cambia si cambia el formulario', async () => {
    await selectSite();
    const payload = { name: 'Cámara fría', type: 'Refrigeración', status: 'operational' as const };
    const first = store.createAsset(payload);
    const failed = http.expectOne({ url: '/api/v1/sites/north/assets', method: 'POST' });
    const key = failed.request.headers.get('Idempotency-Key');
    expect(key).toBeTruthy();
    failed.flush({}, { status: 503, statusText: 'Unavailable' });
    expect(await first).toBe(false);
    const retry = store.createAsset(payload);
    const retried = http.expectOne({ url: '/api/v1/sites/north/assets', method: 'POST' });
    expect(retried.request.headers.get('Idempotency-Key')).toBe(key);
    retried.flush({}, { status: 503, statusText: 'Unavailable' });
    await retry;
    const changed = store.createAsset({ ...payload, name: 'Otro equipo' });
    const different = http.expectOne({ url: '/api/v1/sites/north/assets', method: 'POST' });
    expect(different.request.headers.get('Idempotency-Key')).not.toBe(key);
    different.flush({ id: 'asset-2', ...payload, name: 'Otro equipo' });
    expect(await changed).toBe(true);
    expect(store.assets()[0].id).toBe('asset-2');
  });

  it('descarta respuestas atrasadas al cambiar de sede', async () => {
    const first = store.selectSite({
      id: 'north',
      name: 'Norte',
      timeZone: 'America/Mexico_City',
      role: 'coordinator',
    });
    const oldAssets = http.expectOne('/api/v1/sites/north/assets');
    const oldPending = http.expectOne(
      (request) => request.url === '/api/v1/sites/north/inspections',
    );
    await selectSite('south');
    oldAssets.flush({ items: [{ id: 'secret-north', name: 'No debe verse' }] });
    oldPending.flush({ items: [{ id: 'old-inspection' }] });
    await first;
    expect(store.site()?.id).toBe('south');
    expect(store.assets()).toEqual([]);
    expect(store.pending()).toEqual([]);
  });

  it('registra un cierre y confirma el historial con una lectura del servidor', async () => {
    await selectSite();
    const completion = store.completeInspection(
      { id: 'inspection', assetId: 'asset', dueDate: '2026-11-19', status: 'pending' },
      { result: 'ok', note: 'Temperatura correcta' },
    );
    const request = http.expectOne({
      url: '/api/v1/sites/north/assets/asset/inspections/inspection/completion',
      method: 'PUT',
    });
    request.flush({
      id: 'inspection',
      assetId: 'asset',
      status: 'completed',
      result: 'ok',
      note: 'Temperatura correcta',
      completedAt: '2026-11-19T18:00:00Z',
      completedBy: 'technician',
    });
    await Promise.resolve();
    http.expectOne('/api/v1/sites/north/assets/asset/inspections').flush({
      items: [
        {
          id: 'inspection',
          assetId: 'asset',
          dueDate: '2026-11-19',
          status: 'completed',
          result: 'ok',
          completedBy: 'technician',
        },
      ],
    });
    expect(await completion).toBe(true);
    expect(store.history()[0].completedBy).toBe('technician');
  });

  it('conserva la actualización más reciente si se solapan lecturas de la misma sede', async () => {
    await selectSite();
    const oldLoad = store.refresh();
    const oldAssets = http.expectOne('/api/v1/sites/north/assets');
    const oldPending = http.expectOne(
      (request) => request.url === '/api/v1/sites/north/inspections',
    );
    const recentLoad = store.refresh();
    http.expectOne('/api/v1/sites/north/assets').flush({
      items: [{ id: 'recent', name: 'Equipo reciente', type: 'Frío', status: 'operational' }],
    });
    http
      .expectOne((request) => request.url === '/api/v1/sites/north/inspections')
      .flush({ items: [] });
    await recentLoad;
    oldAssets.flush({ items: [{ id: 'old', name: 'Versión anterior' }] });
    oldPending.flush({ items: [] });
    await oldLoad;
    expect(store.assets()[0].id).toBe('recent');
  });

  it('conserva un equipo creado después de iniciar un refresco atrasado', async () => {
    await selectSite();
    const old = deferRefresh();
    old.assets.flush({ items: [], nextToken: 'stale-assets' });
    const payload = { name: 'Equipo nuevo', type: 'Frío', status: 'operational' as const };
    const created = store.createAsset(payload);
    http
      .expectOne({ url: '/api/v1/sites/north/assets', method: 'POST' })
      .flush({ id: 'new-asset', ...payload });
    expect(await created).toBe(true);
    expect(store.loading()).toBe(false);
    old.pending.flush({ items: [], nextToken: 'stale-pending' });
    await old.load;
    expect(store.assets().map((asset) => asset.id)).toEqual(['new-asset']);
    expect(store.assetsNextToken()).toBe('');
    expect(store.pendingNextToken()).toBe('');
    expect(store.loading()).toBe(false);
    expect(store.saving()).toBe(false);
  });

  it('conserva una inspección programada después de iniciar un refresco atrasado', async () => {
    await selectSite();
    const old = deferRefresh();
    const inspection = {
      id: 'new-inspection',
      assetId: 'asset',
      dueDate: store.dueThrough(),
      status: 'pending' as const,
    };
    const scheduled = store.scheduleInspection('asset', inspection.dueDate);
    http
      .expectOne({ url: '/api/v1/sites/north/assets/asset/inspections', method: 'POST' })
      .flush(inspection);
    await Promise.resolve();
    http.expectOne('/api/v1/sites/north/assets/asset/inspections').flush({ items: [inspection] });
    expect(await scheduled).toBe(true);
    old.assets.flush({ items: [] });
    old.pending.flush({ items: [] });
    await old.load;
    expect(store.pending()).toEqual([inspection]);
    expect(store.history()).toEqual([inspection]);
    expect(store.loading()).toBe(false);
    expect(store.saving()).toBe(false);
  });

  it('no repone una inspección completada desde un refresco atrasado', async () => {
    const inspection: Inspection = {
      id: 'inspection',
      assetId: 'asset',
      dueDate: '2026-11-19',
      status: 'pending',
    };
    await selectSite('north', [inspection]);
    const old = deferRefresh();
    const completed = { ...inspection, status: 'completed', result: 'ok' };
    const completion = store.completeInspection(inspection, { result: 'ok', note: 'Correcto' });
    http
      .expectOne({
        url: '/api/v1/sites/north/assets/asset/inspections/inspection/completion',
        method: 'PUT',
      })
      .flush(completed);
    await Promise.resolve();
    http.expectOne('/api/v1/sites/north/assets/asset/inspections').flush({ items: [completed] });
    expect(await completion).toBe(true);
    old.assets.flush({ items: [] });
    old.pending.flush({ items: [inspection] });
    await old.load;
    expect(store.pending()).toEqual([]);
    expect(store.history()[0].status).toBe('completed');
    expect(store.loading()).toBe(false);
    expect(store.saving()).toBe(false);
  });

  it('descarta el error de un refresco invalidado por una escritura confirmada', async () => {
    await selectSite();
    const old = deferRefresh();
    const payload = { name: 'Equipo nuevo', type: 'Frío', status: 'operational' as const };
    const created = store.createAsset(payload);
    http
      .expectOne({ url: '/api/v1/sites/north/assets', method: 'POST' })
      .flush({ id: 'new-asset', ...payload });
    expect(await created).toBe(true);
    old.assets.flush({}, { status: 503, statusText: 'Unavailable' });
    old.pending.flush({ items: [] });
    await old.load;
    expect(store.error()).toBe('');
    expect(store.notice()).toContain('Equipo registrado');
    expect(store.loading()).toBe(false);
  });

  it('limpia un error de lectura anterior cuando la escritura termina correctamente', async () => {
    await selectSite();
    const old = deferRefresh();
    const payload = { name: 'Equipo nuevo', type: 'Frío', status: 'operational' as const };
    const created = store.createAsset(payload);
    const request = http.expectOne({ url: '/api/v1/sites/north/assets', method: 'POST' });
    old.assets.flush({}, { status: 503, statusText: 'Unavailable' });
    old.pending.flush({ items: [] });
    await old.load;
    expect(store.error()).not.toBe('');
    request.flush({ id: 'new-asset', ...payload });
    expect(await created).toBe(true);
    expect(store.error()).toBe('');
    expect(store.saving()).toBe(false);
  });

  it('mantiene la carga de una lectura posterior a la escritura cuando termina la lectura vieja', async () => {
    await selectSite();
    const old = deferRefresh();
    const payload = { name: 'Equipo nuevo', type: 'Frío', status: 'operational' as const };
    const created = store.createAsset(payload);
    http
      .expectOne({ url: '/api/v1/sites/north/assets', method: 'POST' })
      .flush({ id: 'new-asset', ...payload });
    expect(await created).toBe(true);
    const recent = deferRefresh();
    old.assets.flush({ items: [] });
    old.pending.flush({ items: [] });
    await old.load;
    expect(store.loading()).toBe(true);
    recent.assets.flush({ items: [{ id: 'new-asset', ...payload }], nextToken: 'recent-token' });
    recent.pending.flush({ items: [] });
    await recent.load;
    expect(store.assets()[0].id).toBe('new-asset');
    expect(store.assetsNextToken()).toBe('recent-token');
    expect(store.loading()).toBe(false);
  });

  it('no invalida la lectura de otra sede al terminar una escritura de la sede anterior', async () => {
    await selectSite();
    const payload = { name: 'Equipo norte', type: 'Frío', status: 'operational' as const };
    const created = store.createAsset(payload);
    const oldWrite = http.expectOne({ url: '/api/v1/sites/north/assets', method: 'POST' });
    const selected = store.selectSite({
      id: 'south',
      name: 'Sur',
      timeZone: 'America/Mexico_City',
      role: 'coordinator',
    });
    oldWrite.flush({ id: 'north-asset', ...payload });
    expect(await created).toBe(false);
    expect(store.site()?.id).toBe('south');
    expect(store.loading()).toBe(true);
    http.expectOne('/api/v1/sites/south/assets').flush({ items: [{ id: 'south-asset' }] });
    http
      .expectOne((request) => request.url === '/api/v1/sites/south/inspections')
      .flush({ items: [] });
    await selected;
    expect(store.assets()[0].id).toBe('south-asset');
    expect(store.loading()).toBe(false);
    expect(store.saving()).toBe(false);
    expect(store.error()).toBe('');
  });

  it('pagina equipos sin reiniciar la lista de pendientes ni perder los equipos ya cargados', async () => {
    const selected = store.selectSite({
      id: 'north',
      name: 'Norte',
      timeZone: 'America/Mexico_City',
      role: 'coordinator',
    });
    http
      .expectOne('/api/v1/sites/north/assets')
      .flush({ items: [{ id: 'asset-1', name: 'Primero' }], nextToken: 'next-assets' });
    http
      .expectOne((request) => request.url === '/api/v1/sites/north/inspections')
      .flush({ items: [{ id: 'pending-1', assetId: 'asset-1' }], nextToken: 'next-pending' });
    await selected;
    const next = store.refresh(true, false);
    const request = http.expectOne((candidate) => candidate.url === '/api/v1/sites/north/assets');
    expect(request.request.params.get('nextToken')).toBe('next-assets');
    request.flush({ items: [{ id: 'asset-2', name: 'Segundo' }] });
    http.expectNone((candidate) => candidate.url === '/api/v1/sites/north/inspections');
    await next;
    expect(store.assets().map((asset) => asset.id)).toEqual(['asset-1', 'asset-2']);
    expect(store.pending()[0].id).toBe('pending-1');
    expect(store.pendingNextToken()).toBe('next-pending');
  });
});
