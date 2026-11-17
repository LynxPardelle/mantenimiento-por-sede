import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from './app.routes';

describe('Inicio de Mantenimiento por Sede', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('muestra el estado de la API que usa la aplicación', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne({ url: '/api/health', method: 'GET' });
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain(
      'Mantenimiento por Sede',
    );
    request.flush({ status: 'ok' });
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('[role="status"]')?.textContent).toContain(
      'API disponible',
    );
  });

  it('permite consultar de nuevo después de un error del servidor', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/health').flush(null, { status: 503, statusText: 'Unavailable' });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.querySelector('[role="status"]')?.textContent).toContain(
      'No se pudo conectar con la API',
    );
    harness.routeNativeElement?.querySelector('button')?.click();
    http.expectOne('/api/health').flush({ status: 'ok' });
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('[role="status"]')?.textContent).toContain(
      'API disponible',
    );
  });
});
