/** Clés des paramètres du site, regroupées par domaine. Modifier les noms uniquement ici. */
export const SettingKeys = {
    bot: {
        channels: {
            briefing: 'bot.channels.briefing',
            dimanche: 'bot.channels.dimanche',
            enga: 'bot.channels.enga',
            grosEvent: 'bot.channels.gros_event',
            jeudi: 'bot.channels.jeudi',
            lundi: 'bot.channels.lundi',
            mardi: 'bot.channels.mardi',
            mercredi: 'bot.channels.mercredi',
            rh: 'bot.channels.rh',
            samedi: 'bot.channels.samedi',
            training: 'bot.channels.training',
            vendredi: 'bot.channels.vendredi',
        },
        contracts: {
            fidelisResponsibles: 'bot.contracts.fidelis_responsibles',
        },
        diplomatie: {
            categoryCorporations: 'bot.diplomatie.category_corporations',
            channel: 'bot.diplomatie.channel',
            channelDemande: 'bot.diplomatie.channel_demande',
            role: 'bot.diplomatie.role',
            roleAmbassadeur: 'bot.diplomatie.role_ambassadeur',
        },
        events: {
            briefingTag: 'bot.events.briefing_tag',
            publicationDay: 'bot.events.publication_day',
            publicationTime: 'bot.events.publication_time',
        },
        github: {
            roleDev: 'bot.github.role_dev',
        },
        meeting: {
            keepAudio: 'bot.meeting.keep_audio',
            transcriptionLanguage: 'bot.meeting.transcription_language',
            transcriptionModel: 'bot.meeting.transcription_model',
        },
        recrutement: {
            categoryAdmission: 'bot.recrutement.category_admission',
            roleCandidat: 'bot.recrutement.role_candidat',
            roleParrain: 'bot.recrutement.role_parrain',
            parrainCapacityMax: 'bot.recrutement.parrain_capacity_max',
            youngAccountMinDays: 'bot.recrutement.young_account_min_days',
            youngAccountExemptIds: 'bot.recrutement.young_account_exempt_ids',
            arrivalDays: 'bot.recrutement.arrival_days',
            ticketInactivityDays: 'bot.recrutement.ticket_inactivity_days',
            mentorWaitDays: 'bot.recrutement.mentor_wait_days',
            interviewReminderDays: 'bot.recrutement.interview_reminder_days',
        },
        roles: {
            postulant: 'bot.roles.postulant',
            reserviste: 'bot.roles.reserviste',
        },
        voice: {
            channelCreation: 'bot.voice.channel_creation',
        },
    },
    site: {
        discord: {
            enabled: 'site.discord.enabled',
        },
        certification: {
            captain: 'site.certification.captain',
        },
        directories: {
            briefingTemplates: 'site.directories.briefing_templates',
            eventTemplates: 'site.directories.event_templates',
            eventImages: 'site.directories.event_images',
            badges: 'site.directories.badges',
        },
        roles: {
            members: 'site.roles.members',
            eventManage: 'site.roles.event_manage',
            /** ID Discord du rôle RH unique. */
            rh: 'site.roles.rh',
        },
    },
} as const;

type SettingValues<T> = T extends string ? T : { [K in keyof T]: SettingValues<T[K]> }[keyof T];

export type SettingKey = SettingValues<typeof SettingKeys>;

export const EventChannelSettings = {
    lundi: SettingKeys.bot.channels.lundi,
    mardi: SettingKeys.bot.channels.mardi,
    mercredi: SettingKeys.bot.channels.mercredi,
    jeudi: SettingKeys.bot.channels.jeudi,
    vendredi: SettingKeys.bot.channels.vendredi,
    samedi: SettingKeys.bot.channels.samedi,
    dimanche: SettingKeys.bot.channels.dimanche,
    gros_event: SettingKeys.bot.channels.grosEvent,
    training: SettingKeys.bot.channels.training,
} as const;
