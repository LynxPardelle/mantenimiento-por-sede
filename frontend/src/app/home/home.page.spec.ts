import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HomePage } from './home.page';

describe('Sitio comercial de SedePulso', () => {
  it('ofrece registro gratuito y distingue los planes futuros sin vender funciones inexistentes', async () => {
    TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne('/api/config')
      .flush({ authMode: 'cognito', signupEnabled: true, region: 'us-east-1', clientId: 'client' });
    await fixture.whenStable();
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('a[href="/registro"]')).not.toBeNull();
    expect(html.textContent).toContain('Piloto');
    expect(html.textContent).toContain('Operación');
    expect(html.textContent).toContain('Red');
    expect(html.textContent).toContain('En diseño');
    expect(html.textContent).toContain('Sin tarjeta');
    expect(html.querySelector('a[href*="checkout"]')).toBeNull();
    http.verify();
  });
});
