-- AppFolio is the source of truth for tour confirmations/cancellations (it
-- drives the AppFolio calendar and the Google Calendar sync). Our texts stop
-- asking prospects to "reply YES", the 2-hour reminder is dropped (AppFolio
-- sends its own confirmation request ~2h before), and replies to our texts that
-- confirm/cancel/reschedule alert #leasing (@Jader) with an AppFolio link.
UPDATE public.lead_engine_settings SET
  booked_template_en = 'Hi {first}, you''re booked to tour {property} on {when}. We''ll text you a quick confirmation request a couple of hours before. Need a different time? Just reply here or call (816) 765-0427. Reply STOP to opt out.',
  booked_template_es = 'Hola {first}, tu visita a {property} está agendada para el {when}. Te enviaremos un mensaje para confirmar un par de horas antes. ¿Necesitas otra hora? Responde aquí o llama al (816) 765-0427. Responde STOP para no recibir mensajes.',
  alert_mention_kinds = array(SELECT DISTINCT unnest(alert_mention_kinds || ARRAY['tour_change_request']))
WHERE id = 1;
UPDATE public.lead_outbox SET status = 'skipped', skip_reason = 'AppFolio sends the 2-hour confirmation'
WHERE kind = 'tour_reminder_2h' AND status = 'pending';
