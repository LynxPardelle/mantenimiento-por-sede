import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { MaintenancePage } from './maintenance.page';

describe('Operación de SedePulso en pantalla', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [MaintenancePage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isDemo: signal(true), logout() {} } },
      ],
    }),
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('conserva el formulario tras un fallo y permite registrar equipo, programar y consultar un cierre persistido', async () => {
    const fixture = TestBed.createComponent(MaintenancePage);
    const page = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/v1/sites').flush({
      items: [
        { id: 'north', name: 'Sede Norte', timeZone: 'America/Mexico_City', role: 'coordinator' },
      ],
    });
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne('/api/v1/sites/north/assets').flush({ items: [] });
    http
      .expectOne((request) => request.url === '/api/v1/sites/north/inspections')
      .flush({ items: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Sede Norte');
    page.activeTab.set('assets');
    page.showAssetForm.set(true);
    fixture.detectChanges();
    const name = fixture.nativeElement.querySelector('#asset-name') as HTMLInputElement;
    const type = fixture.nativeElement.querySelector('#asset-type') as HTMLInputElement;
    name.value = 'Cámara fría';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    type.value = 'Refrigeración';
    type.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    const attempt = page.createAsset(new Event('submit'));
    const failed = http.expectOne({ method: 'POST', url: '/api/v1/sites/north/assets' });
    const key = failed.request.headers.get('Idempotency-Key');
    failed.flush({}, { status: 503, statusText: 'Unavailable' });
    await attempt;
    fixture.detectChanges();
    expect(name.value).toBe('Cámara fría');
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain(
      'volver a intentarlo',
    );
    const retry = page.createAsset(new Event('submit'));
    const created = http.expectOne({ method: 'POST', url: '/api/v1/sites/north/assets' });
    expect(created.request.headers.get('Idempotency-Key')).toBe(key);
    created.flush({
      id: 'asset',
      name: 'Cámara fría',
      type: 'Refrigeración',
      status: 'operational',
    });
    await retry;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Equipo registrado');
    expect(fixture.nativeElement.querySelector('#asset-name')).toBeNull();

    page.scheduleModel.set({ assetId: 'asset', dueDate: page.store.dueThrough() });
    const scheduled = page.schedule(new Event('submit'));
    http.expectOne({ method: 'POST', url: '/api/v1/sites/north/assets/asset/inspections' }).flush({
      id: 'inspection',
      assetId: 'asset',
      dueDate: page.store.dueThrough(),
      status: 'pending',
    });
    await Promise.resolve();
    http.expectOne('/api/v1/sites/north/assets/asset/inspections').flush({ items: [] });
    await scheduled;
    page.activeTab.set('pending');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('tbody').textContent).toContain('Cámara fría');
    page.startCompletion(page.store.pending()[0]);
    page.completionModel.set({ result: 'ok', note: 'Temperatura correcta' });
    const completed = page.complete(new Event('submit'));
    http
      .expectOne({
        method: 'PUT',
        url: '/api/v1/sites/north/assets/asset/inspections/inspection/completion',
      })
      .flush({ status: 'completed' });
    await Promise.resolve();
    http.expectOne('/api/v1/sites/north/assets/asset/inspections').flush({
      items: [
        {
          id: 'inspection',
          assetId: 'asset',
          dueDate: page.store.dueThrough(),
          status: 'completed',
          result: 'ok',
          note: 'Temperatura correcta',
          completedAt: '2026-11-19T18:00:00Z',
          completedBy: 'tecnico-prueba',
        },
      ],
    });
    await completed;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.history-list').textContent).toContain(
      'Temperatura correcta',
    );
    expect(fixture.nativeElement.querySelector('.history-list').textContent).toContain(
      'tecnico-prueba',
    );
    expect(page.store.pending()).toEqual([]);
    expect(page.closing()).toBeUndefined();
  });
});
