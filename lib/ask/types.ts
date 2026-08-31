// ASK @GUESTLIST — types. One channel-independent engine: the website,
// @guestlist X replies, and future channels all speak these shapes.

export type AskDate =
  | { kind: 'tonight' } | { kind: 'tomorrow' } | { kind: 'weekend' }
  | { kind: 'next_weekend' } | { kind: 'day'; dow: number }
  | { kind: 'iso'; date: string } | { kind: 'next_month' }
  | { kind: 'window'; days: number };
export type AskSocial = 'connections' | 'close_friends' | 'scene' | null;
export type AskIntent = {
  city:string|null; cityAmbiguous?:boolean; date:AskDate|null; genres:string[]; oldSchool?:boolean;
  daytime?:boolean; lateNight?:boolean; afterHour?:number|null; priceMax?:number|null; sizePref?:'small'|'big'|null;
  social?:AskSocial; momentum?:boolean; worthTravelling?:boolean; travelCity?:string|null;
  archive?:{query:string|null;year:number|null}|null; pastToPresent?:boolean; personalized?:boolean;
  artist?:string|null; venue?:string|null; promoter?:string|null;
};
export type AskCard = {
  type:'event'|'archive'|'interview'; id:string; title:string; slug:string; when:string; city:string|null;
  venueName:string|null; price:string|null; imageUrl:string|null; genres:string[]; reasons:string[];
  social:{connectionsGoing:number;closeGoing:number;names:string[]}|null; momentumNote:string|null; href:string;
};
export type AskAnswerType = 'DIRECT_ANSWER'|'EVENT_RECOMMENDATIONS'|'SOCIAL_DISCOVERY'|'ARCHIVE_DISCOVERY'|'INTERVIEW_DISCOVERY'|'PAST_TO_PRESENT'|'NO_RESULTS'|'CLARIFICATION'|'FOLLOW_UP';
export type AskAnswer = {type:AskAnswerType;commentary:string;cards:AskCard[];followUps:string[];clarification:string|null;relaxation:string|null;conversationId:string;messageId:string};
