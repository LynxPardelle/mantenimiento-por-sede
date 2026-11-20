import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Site } from '../maintenance/maintenance.models';
import { ReviewDraft, ReviewsContext, WeeklyReview } from './pilot-reviews.models';
import { reviewContextResponse, weeklyReviewResponse } from './pilot-reviews.response';

@Injectable({ providedIn: 'root' })
export class PilotReviewsService {
  private readonly http = inject(HttpClient);
  private readonly options = { timeout: 10000, transferCache: false as const };
  private path(site: string): string {
    return `/api/v1/sites/${encodeURIComponent(site)}/pilot/reviews`;
  }
  async sites(): Promise<Site[]> {
    return (await firstValueFrom(this.http.get<{ items: Site[] }>('/api/v1/sites', this.options)))
      .items;
  }
  async context(site: string): Promise<ReviewsContext> {
    return reviewContextResponse(
      await firstValueFrom(this.http.get<unknown>(this.path(site), this.options)),
      site,
    );
  }
  async save(
    site: string,
    week: number,
    expectedRevision: number,
    input: ReviewDraft,
  ): Promise<WeeklyReview> {
    return weeklyReviewResponse(
      await firstValueFrom(
        this.http.put<unknown>(
          `${this.path(site)}/${week}`,
          { expectedRevision, ...input },
          this.options,
        ),
      ),
      week,
    );
  }
  async confirm(site: string, week: number, expectedRevision: number): Promise<WeeklyReview> {
    return weeklyReviewResponse(
      await firstValueFrom(
        this.http.post<unknown>(
          `${this.path(site)}/${week}/confirmation`,
          { expectedRevision, attested: true },
          this.options,
        ),
      ),
      week,
    );
  }
}
