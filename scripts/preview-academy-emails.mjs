// Synthetic local previews only. This script has no provider or network calls.
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
try {
 const { buildAcademyEmail, lifecycleEmailTemplates, escapeHtml } = await server.ssrLoadModule('/supabase/functions/_shared/notification-email.ts');
 const templates = ['welcome','new_post','announcement','comment','reply','mention','post_reaction','comment_reaction','new_event','event_reminder','event_updated','event_cancelled','event_rsvp','new_course','course_unlocked','lesson_published','course_certificate','weekly_digest',...Object.keys(lifecycleEmailTemplates)];
 const output = resolve('output/email-preview'); await mkdir(output,{recursive:true});
 await cp(resolve('public/email-assets'),resolve(output,'email-assets'),{recursive:true});
 await cp(resolve('public/dirty-turf-logo.png'),resolve(output,'dirty-turf-logo.png'));
 const examples = {
 welcome: ['Welcome to 7 Figure Turf Cleaning', 'Your community and courses are ready.'],
 new_post: ['Steve posted in 7 Figure Turf Cleaning', 'How to price your next turf restoration'],
 announcement: ['Live training schedule for October', 'Join this month’s training sessions.'],
 comment: ['Steve commented on your post', 'How to price your next turf restoration'],
 reply: ['Steve replied to your comment', 'How to price your next turf restoration'],
 mention: ['Steve mentioned you in a comment', 'How to price your next turf restoration'],
 post_reaction: ['Steve liked your post', 'How to price your next turf restoration'],
 comment_reaction: ['Steve liked your comment', 'Your advice on pet odor removal'],
 new_event: ['Turf Clean call', 'Turf Clean call'], event_reminder: ['Reminder: Turf Clean call begins in 24 hours', 'Turf Clean call'],
 event_updated: ['Event updated: Turf Clean call', 'Turf Clean call'], event_cancelled: ['Event cancelled: Turf Clean call', 'Turf Clean call'],
 event_rsvp: ['You are registered: Turf Clean call', 'Turf Clean call'], new_course: ['New course available', 'Turf Restoration Essentials'],
 course_unlocked: ['Course unlocked', 'Turf Restoration Essentials'], lesson_published: ['New lesson: Removing pet odors', 'Turf Restoration Essentials'],
 course_certificate: ['Your certificate is ready: Turf Restoration Essentials', 'Turf Restoration Essentials'], weekly_digest: ['Your week in the Dirty Turf community', '5 new discussions this week.'],
 membership_requested: ['We received your community membership request', 'Your request is awaiting review.'],
 membership_request_admin: ['New membership request from Taylor Member', 'Taylor Member would like to join 7 Figure Turf Cleaning.'],
 membership_approved: ['Your community membership is approved', 'Welcome to 7 Figure Turf Cleaning.'],
 membership_declined: ['Your community membership request was declined', 'Contact the community team for help.'],
 membership_removed: ['Your community membership has changed', 'Your membership is no longer active.'],
 membership_removed_admin: ['Community member access changed', 'Taylor Member no longer has community access.'],
 private_channel_added: ['You were added to Pro Operators', 'A private channel is now available to you.'],
 role_changed: ['Your community role has changed', 'Your role is now moderator.'], ownership_transferred: ['Community ownership transferred', 'Your ownership role has changed.'],
 content_reported_admin: ['Community content needs review', 'A post was reported. Open moderation to review it.'],
 group_payment_received: ['Your community payment is confirmed', '7 Figure Turf Cleaning membership'],
 group_payment_received_admin: ['A community payment was received', 'Taylor Member purchased community access.'],
 course_payment_received: ['Your course payment is confirmed', 'Turf Restoration Essentials'],
 course_payment_received_admin: ['A course payment was received', 'Taylor Member purchased Turf Restoration Essentials.'],
 group_subscription_cancelled: ['Your community subscription is cancelled', 'See billing for your remaining access period.'],
 group_subscription_cancelled_admin: ['A community subscription was cancelled', 'Taylor Member cancelled their subscription.'],
 course_subscription_cancelled: ['Your course subscription is cancelled', 'Turf Restoration Essentials'],
 course_subscription_cancelled_admin: ['A course subscription was cancelled', 'Taylor Member cancelled their course subscription.'],
 mention_everyone_post: ['Steve tagged everyone in a post', 'October training schedule'], mention_everyone_comment: ['Steve tagged everyone in a comment', 'Turf Clean call questions'],
 };
 const prepared = new Set(['membership_requested','membership_request_admin','private_channel_added','mention_everyone_post','mention_everyone_comment']);
 const rows=[];
 for(const template of templates) {
  const delivery={id:'00000000-0000-4000-8000-000000000001',recipient_member_id:'00000000-0000-4000-8000-000000000002',recipient_email:'preview@example.com',recipient_name:'Taylor Member',template_key:template,title:examples[template][0],detail:examples[template][1],target_type:template.includes('event')?'event':template.includes('course')||template==='lesson_published'?'course':'community',target_id:'00000000-0000-4000-8000-000000000003',idempotency_key:'preview:'+template,payload:{actorName:'Steve',communityName:'7 Figure Turf Cleaning',eventTitle:'Turf Clean call',startsAt:'2026-10-04T20:00:00Z',endsAt:'2026-10-04T21:00:00Z',timezone:'America/Phoenix',meetingUrl:'https://example.com/meeting',hoursBefore:24,rsvpStatus:'going'}};
  const email=buildAcademyEmail(delivery,{appUrl:'https://app.dirtyturf.com',unsubscribeUrl:'https://example.com/unsubscribe-preview'});
  await writeFile(resolve(output,template+'.html'),email.html.replaceAll('https://app.dirtyturf.com/email-assets/', './email-assets/').replaceAll('https://app.dirtyturf.com/dirty-turf-logo.png', './dirty-turf-logo.png'));
  const status = template.includes('payment') || template.includes('subscription') ? 'Awaiting Stripe setup' : prepared.has(template) ? 'Template ready · feature connection pending' : 'Built locally · waiting to publish';
  rows.push(`<li><a href="${template}.html">${escapeHtml(template.replaceAll('_',' ').replace(/\b\w/g, c=>c.toUpperCase()))}</a><small>${escapeHtml(email.subject)}</small><small>${status}</small></li>`);
 }
 await writeFile(resolve(output,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Academy email previews</title><style>body{font:16px/1.6 system-ui;background:#f1f5ee;color:#123420;margin:0;padding:32px}main{max-width:850px;margin:auto}h1{line-height:1.2}ul{padding:0;list-style:none}li{background:white;margin:12px 0;padding:16px;border-radius:8px}a{color:#087a3d;font-weight:700}small{display:block;color:#54665a}</style><main><h1>Academy email previews</h1><p>Synthetic examples only. No emails sent. This catalog includes both wired notifications and prepared templates; see docs/community-email-parity.md for activation status.</p><ul>${rows.join('')}</ul></main></html>`);
 console.log(`${templates.length} local previews: ${output}/index.html`);
} finally { await server.close(); }
