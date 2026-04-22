export type EventSource = 'commit' | 'review' | 'meeting';

export interface MeetingMapping {
  match: string;
  jiraKey: string;
  description?: string;
  /** If true, matching meetings are dropped from the preview entirely. */
  skip?: boolean;
}

export interface GithubOrgsConfig {
  orgs: string[];
}

export interface DescriptionTemplates {
  commit: string;
  review: string;
  meeting: string;
}

export interface TeamDefaults {
  meetings: MeetingMapping[];
  descriptionTemplates: DescriptionTemplates;
  defaultMinutes: {
    commitPerIssuePerDay: number;
    reviewPerPrPerDay: number;
  };
}

export interface WorklogEntry {
  id: string;
  issueKey: string;
  date: string;
  minutes: number;
  comment: string;
  source: EventSource;
  include: boolean;
  resolved: boolean;
  issueTitle?: string;
}

export type AttendanceFilter = 'accepted' | 'all' | 'all-except-declined';

export interface UserSettings {
  githubToken?: string;
  attendanceFilter: AttendanceFilter;
  userMeetingMappings: MeetingMapping[];
  userDescriptionTemplates?: Partial<DescriptionTemplates>;
}
