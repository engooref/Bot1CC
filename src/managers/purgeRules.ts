import type { RecruitmentMentorship, RecrutementStatus } from '../entities/recrutement/RecrutementDemande.js';

/** Statuts qui ferment un dossier de recrutement : tous les autres sont « ouverts ». */
export const CLOSED_RECRUITMENT_STATUSES: readonly RecrutementStatus[] = ['refused', 'expired', 'integrated'];

/** Un dossier est ouvert si son statut n'est ni refused, ni expired, ni integrated, et si son mentorat n'est pas clos. */
export function isOpenRecruitmentDossier(dossier: { status: RecrutementStatus; mentorship?: RecruitmentMentorship | null }): boolean {
  if (CLOSED_RECRUITMENT_STATUSES.includes(dossier.status)) return false;
  return !dossier.mentorship?.closedAt;
}

/** Décide si la purge doit épargner un compte : dossier ouvert, ou ancien rhmember « Candidatures ». */
export function shouldSparePurgedUser(opts: { hasOpenDossier: boolean; rhMemberStatus?: string | null }): boolean {
  return opts.hasOpenDossier || opts.rhMemberStatus === 'Candidatures';
}
