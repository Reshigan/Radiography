import { eq } from 'drizzle-orm';
import { schema, type ConversationMessage } from '@bonakala/db';
import { defineHand } from '@bonakala/domain';
import { registerHand, runHand, type Services } from '../../kernel/index.js';
import { matchPatient, parseWithProvenance, createOrder } from '../m04-referrals/service.js';
import { loadCatalogue } from '../m04-referrals/catalogue.js';
import { ensureFundingCase, fundingForOrder } from '../m06-funding/service.js';
import { confirmHold, describeSlot, earliestNearMe, holdSlot, activeHoldsForPatient } from './service.js';
import { appendMessage, outboundCountToday, sendWhatsApp, setInboundHandler } from '../../sim/whatsapp.js';

/**
 * Booking Hand (docs/processes/02 §7.11). A3 within its leash: books only into open capacity, never
 * outside licensed hours (the slot engine enforces that), at most 3 live holds per patient, message caps
 * per day, hands over to BKG on distress, clinical questions or two misunderstandings. States no price
 * other than the M06 quote and never gives clinical information.
 */
export const bookingHand = defineHand({
  id: 'booking', name: 'Booking Hand', module: 'M05', level: 'A3',
  mandate: 'Book, confirm, reschedule and cancel appointments end-to-end over WhatsApp; run pre-booking safety screens; offer waitlist slots; send reminders; answer routine logistics questions.',
  defaultLeash: { maxHoldsPerPatient: 3, maxMessagesPerDay: 5, maxSlotOffers: 3, maxMisunderstandings: 2 },
  approvalPersona: 'BKG', approvalPolicy: 'BKG takes over threads the Hand escalates: distress, clinical questions, sedation or paediatric anaesthesia, two misunderstandings, or leash limits reached.',
  tools: { 'document.extract': 'R0', 'llm.extract': 'R0', 'patient.search': 'R0', 'patient.contact_read': 'R0', 'funding.status_read': 'R0', 'safety.prescreen': 'R0', 'slot.search': 'R0', 'order.create': 'R1', 'slot.hold': 'R1', 'appointment.book': 'R1', 'waitlist.add': 'R1', 'message.send': 'R2', 'task.create': 'R1' },
});

const DISTRESS = /(scared|frightened|terrified|crying|angry|furious|complain|useless|pain is unbearable|emergency|can'?t breathe|help me)/i;
const CLINICAL_QUESTION = /(is it cancer|do i have|what does .* mean|will it hurt|is this serious|what is wrong with me|results?\b.*\?|diagnos)/i;
const HUMAN = /\b(person|human|agent|someone|talk to (?:a|someone)|call me)\b/i;
const YES = /^\s*(yes|yebo|ja|ok(?:ay)?|correct|that'?s right|confirm|y)\b/i;

export interface BookingHandInput extends Record<string, unknown> { conversationId: string; text: string; practiceId: string }

function line(text: string, buttons?: string[]): ConversationMessage {
  return { dir: 'out', text, at: new Date().toISOString(), buttons, by: 'hand:booking' };
}

export function registerBookingHand() {
  registerHand<BookingHandInput, Record<string, unknown>>(bookingHand, async (input, ctx) => {
    const services = ctx.services;
    const [conv] = await services.db.select().from(schema.conversations).where(eq(schema.conversations.id, input.conversationId)).limit(1);
    if (!conv) throw new Error('Conversation not found');
    const text = input.text.trim();
    const replies: ConversationMessage[] = [];
    const send = async (t: string, buttons?: string[]) => {
      const used = await outboundCountToday(services, conv.id);
      ctx.leashCheck([{ rule: 'maxMessagesPerDay', actual: used + 1 }]);
      await ctx.step('message.send', { to: '[MOBILE]', chars: t.length }, () => sendWhatsApp(services, { practiceId: conv.practiceId, to: conv.mobile, text: t, buttons, by: 'hand:booking', patientId: conv.patientId }));
      replies.push(line(t, buttons));
    };
    const handOver = async (reason: string, message: string) => {
      await send(message);
      await ctx.step('task.create', { queue: 'BKG', reason }, async () => ({ queue: 'booking_inbox', conversationId: conv.id }));
      await services.db.update(schema.conversations).set({ state: 'handed_over', handedOverReason: reason, updatedAt: new Date().toISOString() }).where(eq(schema.conversations.id, conv.id));
      return { state: 'handed_over', reason, replies: replies.length };
    };

    if (DISTRESS.test(text)) return handOver('distress', 'I am asking a person from our booking team to call you now. They will be with you shortly.');
    if (CLINICAL_QUESTION.test(text)) return handOver('clinical_question', 'I cannot answer questions about your health or your results. A person from our team will help you, and your doctor discusses results with you.');
    if (HUMAN.test(text) && !/^\s*(yes|no)\b/i.test(text)) return handOver('requested_person', 'Of course. A person from our booking team will pick up this conversation shortly.');

    const state = conv.state;
    let patientId = conv.patientId;

    // Identify the patient from the number first.
    if (!patientId) {
      const m = await ctx.step('patient.search', { mobile: '[MOBILE]' }, () => matchPatient(services, conv.practiceId, { mobile: conv.mobile }));
      if (m && m.confidence >= 0.9) {
        patientId = m.patientId;
        await services.db.update(schema.conversations).set({ patientId, optIn: true }).where(eq(schema.conversations.id, conv.id));
      }
    }
    if (!patientId) {
      const id = /\b(\d{13})\b/.exec(text)?.[1];
      if (id) {
        const m = await ctx.step('patient.search', { idNumber: '[ID]' }, () => matchPatient(services, conv.practiceId, { idNumber: id }));
        if (m) { patientId = m.patientId; await services.db.update(schema.conversations).set({ patientId, optIn: true }).where(eq(schema.conversations.id, conv.id)); }
      }
      if (!patientId) {
        await send('Sawubona, I am the Bonakala booking assistant. Reply with your ID number so I can find your file, or type "person" to speak to someone.');
        await services.db.update(schema.conversations).set({ state: 'awaiting_identity', updatedAt: new Date().toISOString() }).where(eq(schema.conversations.id, conv.id));
        return { state: 'awaiting_identity', replies: replies.length };
      }
    }
    const [patient] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, patientId)).limit(1);

    // Offer reply: a number choice books the held slot.
    if (state === 'awaiting_slot_choice' && conv.offers?.length) {
      const choice = /^\s*([123])\b/.exec(text)?.[1] ?? (YES.test(text) ? '1' : undefined);
      if (!choice) {
        const mis = conv.misunderstandings + 1;
        await services.db.update(schema.conversations).set({ misunderstandings: mis }).where(eq(schema.conversations.id, conv.id));
        if (mis >= Number(ctx.leash['maxMisunderstandings'] ?? 2)) return handOver('misunderstandings', 'Let me bring in a person from our booking team to help you choose a time.');
        await send('Reply 1, 2 or 3 to choose a time, or "person" to speak to someone.');
        return { state, replies: replies.length };
      }
      const offer = conv.offers[Number(choice) - 1];
      if (!offer) { await send('That option is not available. Reply 1, 2 or 3.'); return { state, replies: replies.length }; }
      const appt = await ctx.step('appointment.book', { appointmentId: offer.appointmentId }, () => confirmHold(services, offer.appointmentId, { bookedBy: 'hand:booking', sendConfirmation: false }));
      const [site] = await services.db.select().from(schema.sites).where(eq(schema.sites.id, appt.siteId)).limit(1);
      const cat = await loadCatalogue(services);
      const proc = cat.find((p) => p.code === appt.procedureCode);
      const funding = await ctx.step('funding.status_read', { orderId: appt.orderId }, () => fundingForOrder(services, appt.orderId));
      const portion = funding?.fundingCase.patientPortionCents ?? 0;
      const price = funding ? (portion === 0 ? 'Your scheme covers this: you pay R0 on the day.' : `You pay R${Math.round(portion / 100)} on the day, nothing more later.`) : '';
      await send(`Booked: ${proc?.description ?? appt.procedureCode}, ${describeSlot(appt.startsAt, site?.name ?? '')}. Bring ID, scheme card and the referral. ${proc?.prep ?? ''} ${price}`.replace(/\s+/g, ' ').trim(), ['Pre-check-in', 'Directions', 'Reschedule']);
      for (const o of conv.offers) if (o.appointmentId !== offer.appointmentId) await services.db.update(schema.appointments).set({ status: 'cancelled', cancelReason: 'other slot chosen' }).where(eq(schema.appointments.id, o.appointmentId));
      await services.db.update(schema.conversations).set({ state: 'booked', appointmentId: appt.id, orderId: appt.orderId, offers: [], updatedAt: new Date().toISOString() }).where(eq(schema.conversations.id, conv.id));
      return { state: 'booked', appointmentId: appt.id, orderId: appt.orderId, replies: replies.length };
    }

    // Referral text or photo: parse, create the order, check funding, offer three slots.
    let orderId = conv.orderId;
    if (!orderId) {
      const parsed = await parseWithProvenance(services, conv.practiceId, text, ctx.step.bind(ctx));
      if (!parsed.procedureCode) {
        if (state === 'awaiting_referral') {
          const mis = conv.misunderstandings + 1;
          await services.db.update(schema.conversations).set({ misunderstandings: mis }).where(eq(schema.conversations.id, conv.id));
          if (mis >= Number(ctx.leash['maxMisunderstandings'] ?? 2)) return handOver('misunderstandings', 'I could not read the referral. A person from our booking team will help you.');
        }
        await send(`Sawubona ${patient?.firstName ?? ''}. Send a photo of your referral note, or type the words on it, and I will find you a time.`.replace(/\s+/g, ' '));
        await services.db.update(schema.conversations).set({ state: 'awaiting_referral', updatedAt: new Date().toISOString() }).where(eq(schema.conversations.id, conv.id));
        return { state: 'awaiting_referral', replies: replies.length };
      }
      const proc = (await loadCatalogue(services)).find((p) => p.code === parsed.procedureCode)!;
      if (proc.safetySets.includes('sedation')) return handOver('sedation', 'This examination needs a booking with sedation cover. A person from our team will arrange it with you.');
      // Pre-booking safety screen (full screening is M07).
      const prescreen = await ctx.step('safety.prescreen', { sets: proc.safetySets }, async () => ({ sets: proc.safetySets, flags: patient?.flags ?? [] }));
      const order = await ctx.step('order.create', { procedure: proc.code, priority: parsed.urgency }, () => createOrder(services, { practiceId: conv.practiceId, patientId: patientId!, referrerId: parsed.referrerId ?? null, channel: 'whatsapp', procedures: [{ code: proc.code, laterality: parsed.laterality, contrast: parsed.contrast }], priority: parsed.urgency === 'stat' ? 'urgent' : parsed.urgency, icd10: parsed.icd10, clinicalInfo: parsed.clinicalInfo ?? null, createdBy: 'hand:booking' }));
      orderId = order.id;
      await services.db.update(schema.conversations).set({ orderId, updatedAt: new Date().toISOString() }).where(eq(schema.conversations.id, conv.id));
      ctx.log(`Pre-screen sets: ${prescreen.sets.join(', ') || 'none'}`);
    }

    const funding = await ctx.step('funding.status_read', { orderId }, async () => {
      const existing = await fundingForOrder(services, orderId!);
      if (existing) return existing;
      await ensureFundingCase(services, orderId!, { actor: 'hand:booking' });
      return fundingForOrder(services, orderId!);
    });
    const holds = await activeHoldsForPatient(services, patientId);
    const maxHolds = Number(ctx.leash['maxHoldsPerPatient'] ?? 3);
    const room = Math.max(0, maxHolds - holds);
    ctx.leashCheck([{ rule: 'maxHoldsPerPatient', actual: Math.min(3, room) + holds }]);
    const search = await ctx.step('slot.search', { orderId }, () => earliestNearMe(services, { orderId: orderId!, limit: Math.min(3, room || 1) }));
    if (!search.offers.length) {
      await ctx.step('waitlist.add', { orderId }, async () => {
        const [o] = await services.db.select().from(schema.orders).where(eq(schema.orders.id, orderId!)).limit(1);
        const { newId } = await import('@bonakala/domain');
        await services.db.insert(schema.waitlist).values({ id: newId('wlt'), practiceId: conv.practiceId, orderId: orderId!, patientId: patientId!, procedureCode: o!.procedures[0]!.code, modalityType: o!.procedures[0]!.modality, priority: o!.priority, status: 'open' });
      });
      await send('There is no open time in the next two weeks. I have put you on the waitlist and will message you the moment a slot opens.');
      return { state: 'waitlisted', orderId, replies: replies.length };
    }
    const offers: NonNullable<typeof conv.offers> = [];
    for (const s of search.offers) {
      const hold = await ctx.step('slot.hold', { roomId: s.roomId, startsAt: s.startsAt }, () => holdSlot(services, { orderId: orderId!, roomId: s.roomId, startsAt: s.startsAt, source: 'whatsapp', bookedBy: 'hand:booking', maxHoldsPerPatient: maxHolds })).catch(() => null);
      if (hold) offers.push({ appointmentId: hold.id, label: describeSlot(s.startsAt, s.siteName), startsAt: s.startsAt, siteId: s.siteId, roomId: s.roomId });
    }
    if (!offers.length) return handOver('no_holds', 'I could not hold a time for you just now. A person from our booking team will call you.');
    const portion = funding?.fundingCase.patientPortionCents ?? null;
    const priceLine = portion === null ? '' : portion === 0 ? 'Your scheme has confirmed the benefit: you pay R0 on the day.' : `Your scheme pays R${Math.round((funding!.fundingCase.schemePortionCents) / 100)}. You pay R${Math.round(portion / 100)}, guaranteed for this appointment.`;
    await send(`${priceLine} Earliest near you: ${offers.map((o, i) => `${i + 1}) ${o.label}`).join('  ')}. Reply 1, 2 or 3.`.replace(/\s+/g, ' ').trim(), offers.map((o) => o.label).slice(0, 3));
    await services.db.update(schema.conversations).set({ state: 'awaiting_slot_choice', offers, updatedAt: new Date().toISOString() }).where(eq(schema.conversations.id, conv.id));
    return { state: 'awaiting_slot_choice', orderId, offers: offers.length, replies: replies.length };
  });
}

/** Wire the WhatsApp simulator's inbound messages to the Booking Hand. */
export function registerBookingInbound() {
  setInboundHandler(async (services: Services, input) => {
    const [before] = await services.db.select().from(schema.conversations).where(eq(schema.conversations.id, input.conversationId)).limit(1);
    const sentBefore = (before?.messages ?? []).filter((m) => m.dir === 'out').length;
    const task = await runHand<BookingHandInput>(services, 'booking', { conversationId: input.conversationId, text: input.text, practiceId: input.practiceId }, { practiceId: input.practiceId, trigger: 'whatsapp.inbound', title: `WhatsApp ${input.from}`, aggregateType: 'conversation', aggregateId: input.conversationId });
    await services.db.update(schema.conversations).set({ lastTaskId: task.id }).where(eq(schema.conversations.id, input.conversationId));
    if (task.status === 'needs_approval' || task.status === 'failed' || task.status === 'refused') {
      const note = task.status === 'needs_approval' ? 'A person from our booking team will continue this conversation.' : 'A person from our booking team will help you shortly.';
      await appendMessage(services, input.conversationId, { dir: 'out', text: note, at: new Date().toISOString(), by: 'system' }, { state: 'handed_over', handedOverReason: task.approvalReason ?? task.error ?? task.status });
    }
    const [after] = await services.db.select().from(schema.conversations).where(eq(schema.conversations.id, input.conversationId)).limit(1);
    const sent = (after?.messages ?? []).filter((m) => m.dir === 'out').slice(sentBefore);
    return { replies: sent, state: after?.state ?? 'new', taskId: task.id };
  });
}
