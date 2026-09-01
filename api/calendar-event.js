// Creates (or deletes) an event on the connected Google Calendar's primary calendar.
// POST body to create: { title, start, end, notes, attendees:[email], meet:bool, timezone }
// POST body to delete: { action:'delete', eventId }
// start/end are local wall-clock strings 'YYYY-MM-DDTHH:MM:SS'; timezone names the zone.
import { guard, sweep } from '@getproytech/core/guard';
import { getAccessToken } from './_google.js';

const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

export default async function handler(req, res) {
  // Unauthenticated this wrote events into the connected Google Calendar.
  // guard() handles OPTIONS and the POST-only check itself.
  const gate = await guard(req, res, {
    name: 'calendar-event', perIp: 40, windowMin: 10, perDay: 1500,
    maxChars: 20000, requireAuth: true,
  });
  if (!gate.ok) return;
  sweep();

  try {
    const token = await getAccessToken();
    if (!token) { res.status(200).json({ ok: false, error: 'not_connected' }); return; }
    const b = req.body || {};

    if (b.action === 'delete') {
      if (!b.eventId) { res.status(400).json({ ok: false, error: 'no eventId' }); return; }
      const r = await fetch(`${CAL}/${encodeURIComponent(b.eventId)}?sendUpdates=all`, {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
      });
      // 410/404 = already gone; treat as success
      if (!r.ok && r.status !== 410 && r.status !== 404) {
        res.status(200).json({ ok: false, error: await r.text() }); return;
      }
      res.status(200).json({ ok: true }); return;
    }

    if (!b.start || !b.end) { res.status(400).json({ ok: false, error: 'start/end required' }); return; }
    const tz = b.timezone || 'America/Chicago';
    const event = {
      summary: b.title || 'Meeting',
      description: b.notes || '',
      start: { dateTime: b.start, timeZone: tz },
      end: { dateTime: b.end, timeZone: tz },
    };
    if (Array.isArray(b.attendees) && b.attendees.length) {
      event.attendees = b.attendees.filter(Boolean).map((email) => ({ email }));
    }
    let url = CAL + '?sendUpdates=all';
    if (b.meet) {
      url += '&conferenceDataVersion=1';
      event.conferenceData = {
        createRequest: { requestId: 'proytech-' + Date.now(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
      };
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    const j = await r.json();
    if (!r.ok) { res.status(200).json({ ok: false, error: (j.error && j.error.message) || 'create failed' }); return; }
    const meetLink = ((j.conferenceData && j.conferenceData.entryPoints) || [])
      .find((p) => p.entryPointType === 'video')?.uri || '';
    res.status(200).json({ ok: true, eventId: j.id, htmlLink: j.htmlLink || '', meetLink });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.message || 'error' });
  }
}
