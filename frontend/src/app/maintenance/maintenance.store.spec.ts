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

  async function selectSite(id = 'north') {
    const load = store.selectSite({
      id,
      name: id,
      timeZone: 'America/Mexico_City',
      role: 'coordinator',
    });
    http.expectOne(`/api/v1/sites/${id}/assets`).flush({ items: [] });
    http
      .expectOne((request) => request.url === `/api/v1/sites/${id}/inspections`)
      .flush({ items: [] });
    await load;
  }

  function mutate(operation: 'create' | 'schedule' | 'complete') {
    const inspection: Inspection = {
      id: 'inspection',
      assetId: 'asset',
      dueDate: store.dueThrough(),
      status: 'pending',
    };
    if (operation === 'create')
      return store.createAsset({ name: 'Equipo nuevo', type: 'Frío', status: 'operational' });
    if (operation === 'schedule') return store.scheduleInspection('asset', inspection.dueDate);
    return store.completeInspection(inspection, { result: 'ok', note: 'Correcto' });
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

  it.each(['create', 'schedule', 'complete'] as const)(
    'rechaza %s durante la carga inicial y conserva inventario, pendientes y cursores',
    async (operation) => {
      const selected = store.selectSite({
        id: 'north',
        name: 'Norte',
        timeZone: 'America/Mexico_City',
        role: 'coordinator',
      });
      http.expectOne('/api/v1/sites/north/assets').flush({
        items: [{ id: 'existing-asset', name: 'Equipo existente' }],
        nextToken: 'next-assets',
      });
      const pending = http.expectOne(
        (request) => request.url === '/api/v1/sites/north/inspections',
      );
      const attempted = mutate(operation);
      const writes = http.match((request) => request.method !== 'GET');
      writes.forEach((request) =>
        request.flush({}, { status: 503, statusText: 'Unexpected write' }),
      );
      const result = await attempted;
      expect(store.loading()).toBe(true);
      pending.flush({
        items: [{ id: 'existing-inspection', assetId: 'existing-asset' }],
        nextToken: 'next-pending',
      });
      await selected;
      expect(writes).toHaveLength(0);
      expect(result).toBe(false);
      expect(store.assets().map((asset) => asset.id)).toEqual(['existing-asset']);
      expect(store.pending().map((inspection) => inspection.id)).toEqual(['existing-inspection']);
      expect(store.assetsNextToken()).toBe('next-assets');
      expect(store.pendingNextToken()).toBe('next-pending');
      expect(store.loading()).toBe(false);
      expect(store.saving()).toBe(false);
      expect(store.error()).toBe('');

      if (operation === 'create') {
        const created = mutate('create');
        http
          .expectOne({ url: '/api/v1/sites/north/assets', method: 'POST' })
          .flush({ id: 'new-asset', name: 'Equipo nuevo' });
        expect(await created).toBe(true);
        expect(store.assets().map((asset) => asset.id)).toEqual(['new-asset', 'existing-asset']);
        expect(store.pending()[0].id).toBe('existing-inspection');
        expect(store.assetsNextToken()).toBe('next-assets');
        expect(store.pendingNextToken()).toBe('next-pending');
      }
    },
  );

  it.each(['create', 'schedule', 'complete'] as const)(
    'no inicia refrescos ni paginación mientras se guarda %s',
    async (operation) => {
      await selectSite();
      const mutation = mutate(operation);
      const write = http.expectOne((request) => request.method !== 'GET');
      const reads = [store.refresh(), store.refresh(true, false), store.refresh(false, true)];
      const unexpected = http.match(
        (request) =>
          request.url === '/api/v1/sites/north/assets' ||
          request.url === '/api/v1/sites/north/inspections',
      );
      unexpected.forEach((request) => request.flush({ items: [] }));
      await Promise.all(reads);
      expect(store.saving()).toBe(true);
      write.flush({
        id: operation === 'create' ? 'new-asset' : 'inspection',
        assetId: 'asset',
        dueDate: store.dueThrough(),
        status: operation === 'complete' ? 'completed' : 'pending',
      });
      if (operation !== 'create') {
        await Promise.resolve();
        http.expectOne('/api/v1/sites/north/assets/asset/inspections').flush({ items: [] });
      }
      expect(await mutation).toBe(true);
      expect(unexpected).toHaveLength(0);
      expect(store.loading()).toBe(false);
      expect(store.saving()).toBe(false);
      expect(store.error()).toBe('');
    },
  );

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
    const attempted = mutate('create');
    const writes = http.match((candidate) => candidate.method !== 'GET');
    writes.forEach((write) => write.flush({}, { status: 503, statusText: 'Unexpected write' }));
    const result = await attempted;
    request.flush({ items: [{ id: 'asset-2', name: 'Segundo' }] });
    http.expectNone((candidate) => candidate.url === '/api/v1/sites/north/inspections');
    await next;
    expect(writes).toHaveLength(0);
    expect(result).toBe(false);
    expect(store.assets().map((asset) => asset.id)).toEqual(['asset-1', 'asset-2']);
    expect(store.pending()[0].id).toBe('pending-1');
    expect(store.pendingNextToken()).toBe('next-pending');
  });
});
