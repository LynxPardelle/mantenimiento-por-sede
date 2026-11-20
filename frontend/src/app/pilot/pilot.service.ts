import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Site } from '../maintenance/maintenance.models';
import { PilotAgreements, PilotContext, PilotDraft, PilotEnrollment } from './pilot.models';
import { pilotContextResponse, pilotEnrollmentResponse } from './pilot.response';

@Injectable({ providedIn: 'root' })
export class PilotService {
  private readonly http = inject(HttpClient);
  private readonly options = { timeout: 10000, transferCache: false as const };
  private path(siteId: string): string {
    return `/api/v1/sites/${encodeURIComponent(siteId)}/pilot`;
  }
  async sites(): Promise<Site[]> {
    return (await firstValueFrom(this.http.get<{ items: Site[] }>('/api/v1/sites', this.options)))
      .items;
  }
  async context(siteId: string): Promise<PilotContext> {
    return pilotContextResponse(
      await firstValueFrom(this.http.get<unknown>(this.path(siteId), this.options)),
      siteId,
    );
  }
  async save(
    siteId: string,
    expectedRevision: number,
    input: PilotDraft,
  ): Promise<PilotEnrollment> {
    return pilotEnrollmentResponse(
      await firstValueFrom(
        this.http.put<unknown>(this.path(siteId), { expectedRevision, ...input }, this.options),
      ),
    );
  }
  async enroll(
    siteId: string,
    expectedRevision: number,
    agreements: PilotAgreements,
  ): Promise<PilotEnrollment> {
    return pilotEnrollmentResponse(
      await firstValueFrom(
        this.http.post<unknown>(
          `${this.path(siteId)}/enrollment`,
          { expectedRevision, agreements },
          this.options,
        ),
      ),
    );
  }
}
