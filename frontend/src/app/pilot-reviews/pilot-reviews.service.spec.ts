import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PilotReviewsService } from './pilot-reviews.service';
import { testReviewsContext, testWeeklyReview } from './pilot-reviews.fixture';
import { emptyReviewModel, reviewPayload } from './pilot-reviews.models';

describe('API de revisión semanal privada', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    return {
      service: TestBed.inject(PilotReviewsService),
      http: TestBed.inject(HttpTestingController),
    };
  }
  it('consulta contexto por sede sin transferirlo al HTML SSR', async () => {
    const { service, http } = setup();
    const promise = service.context('north');
    const request = http.expectOne('/api/v1/sites/north/pilot/reviews');
    expect(request.request.transferCache).toBe(false);
    request.flush(testReviewsContext());
    expect((await promise).weeks.length).toBe(4);
    http.verify();
  });
  it('envía sólo la captura/revisión y confirma con declaración explícita', async () => {
    const { service, http } = setup();
    const input = reviewPayload(emptyReviewModel());
    const save = service.save('north', 1, 0, input);
    const request = http.expectOne('/api/v1/sites/north/pilot/reviews/1');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ expectedRevision: 0, ...input });
    request.flush(testWeeklyReview());
    await save;
    const confirm = service.confirm('north', 1, 1);
    const post = http.expectOne('/api/v1/sites/north/pilot/reviews/1/confirmation');
    expect(post.request.body).toEqual({ expectedRevision: 1, attested: true });
    post.flush(testWeeklyReview('confirmed'));
    await confirm;
    http.verify();
  });
  it('rechaza una respuesta incompatible sin exponer su contenido', async () => {
    const { service, http } = setup();
    const promise = service.context('north');
    const rejection = expect(promise).rejects.toThrow('pilot_review_response_unavailable');
    http
      .expectOne('/api/v1/sites/north/pilot/reviews')
      .flush({ privateText: 'never render', weeks: [] });
    await rejection;
    http.verify();
  });
});
