// Built-in quick replies. These ship with the app and are merged with the user's own templates
// at runtime, so app updates never overwrite user edits (edits are stored as overrides by id).
//
// The first four are required verbatim. Templates flagged `assertsAction` state that something
// has happened (an escalation, a booking, contact) — the UI reminds the user to send them only
// when that is true. `mentionsAttachment` templates say a file is attached.

export const CATEGORIES = [
  'Appointments',
  'Patient Communication',
  'Referrals',
  'Reports',
  'Escalations',
  'Fortius',
  'Queen Square',
  'Clinic Lists',
  'General Administration',
];

const RA = 'Kind regards,\nRadiology Administration';

export const BUILTIN_TEMPLATES = [
  {
    id: 'builtin:fortius-escalation',
    name: 'Fortius Escalation',
    category: 'Fortius',
    subject: '',
    body: 'It has been raised to Fortius and they will contact the patient as soon as possible.',
    assertsAction: true,
  },
  {
    id: 'builtin:queen-square-escalation',
    name: 'Queen Square Escalation',
    category: 'Queen Square',
    subject: '',
    body: 'It has been raised to Queen Square and they will contact the patient as soon as possible.',
    assertsAction: true,
  },
  {
    id: 'builtin:patient-contact-booking',
    name: 'Patient Contact and Booking',
    category: 'Patient Communication',
    subject: '',
    body: 'I will contact the patient and will book him accordingly.',
  },
  {
    id: 'builtin:clinic-list-request',
    name: 'Clinic List Request',
    category: 'Clinic Lists',
    subject: 'Clinic list for {Date}',
    body: 'Find the clinic list for {Date}',
  },
  {
    id: 'builtin:patient-contact-booking-neutral',
    name: 'Patient Contact and Booking (gender-neutral)',
    category: 'Patient Communication',
    subject: '',
    body: 'I will contact the patient and will book them accordingly.',
  },
  {
    id: 'builtin:appointment-confirmation',
    name: 'Appointment Confirmation',
    category: 'Appointments',
    subject: '{scan_type} appointment confirmation - {date}',
    body: `Dear {patient_name},\n\nYour {scan_type} appointment has been confirmed for {date} at {time}.\n\n${RA}`,
    assertsAction: true,
  },
  {
    id: 'builtin:appointment-scheduled',
    name: 'Appointment Scheduled',
    category: 'Appointments',
    subject: 'Your {scan_type} appointment - {date}',
    body: `Dear {patient_name},\n\nYour {scan_type} appointment is scheduled for {date} at {time}.\n\nPlease contact us if you require any assistance.\n\n${RA}`,
    assertsAction: true,
  },
  {
    id: 'builtin:appointment-rescheduling',
    name: 'Appointment Rescheduling',
    category: 'Appointments',
    subject: 'Your {scan_type} appointment',
    body: `Dear {patient_name},\n\nWe need to rearrange your {scan_type} appointment.\n\nPlease contact us so we can discuss an alternative date and time.\n\n${RA}`,
  },
  {
    id: 'builtin:awaiting-patient-contact',
    name: 'Awaiting Patient Contact',
    category: 'Patient Communication',
    subject: '',
    body: 'We are currently awaiting a response from the patient and will provide an update once contact has been established.',
    assertsAction: true,
  },
  {
    id: 'builtin:unable-to-contact',
    name: 'Unable to Contact Patient',
    category: 'Patient Communication',
    subject: '',
    body: 'We have attempted to contact the patient but have not yet been successful. We will make another attempt and provide an update accordingly.',
    assertsAction: true,
  },
  {
    id: 'builtin:booking-in-progress',
    name: 'Booking in Progress',
    category: 'Appointments',
    subject: '',
    body: "The patient's appointment is currently being arranged. We will provide confirmation once the booking has been completed.",
    assertsAction: true,
  },
  {
    id: 'builtin:referral-follow-up',
    name: 'Referral Follow-up',
    category: 'Referrals',
    subject: 'Referral update - {patient_name}',
    body: 'Could you please provide an update regarding the referral for {patient_name}?\n\nMany thanks.',
  },
  {
    id: 'builtin:report-follow-up',
    name: 'Report Follow-up',
    category: 'Reports',
    subject: '{scan_type} report',
    body: 'Could you please advise whether the report for {scan_type} is available?\n\nMany thanks.',
  },
  {
    id: 'builtin:report-available',
    name: 'Report Available',
    category: 'Reports',
    subject: '',
    body: 'The report is now available. Please refer to the appropriate reporting system for further details.',
    assertsAction: true,
  },
  {
    id: 'builtin:patient-will-be-contacted',
    name: 'Patient Will Be Contacted',
    category: 'Patient Communication',
    subject: '',
    body: 'The patient will be contacted to arrange an appropriate appointment.',
  },
  {
    id: 'builtin:clinic-list-email',
    name: 'Clinic List Email',
    category: 'Clinic Lists',
    subject: 'Clinic list - {date}',
    body: `Please find attached the clinic list for {date}.\n\n${RA}`,
    mentionsAttachment: true,
  },
  {
    id: 'builtin:further-information',
    name: 'Request for Further Information',
    category: 'General Administration',
    subject: '',
    body: 'Could you please provide the additional information required to proceed with this request?\n\nMany thanks.',
  },
  {
    id: 'builtin:escalation-acknowledgement',
    name: 'Escalation Acknowledgement',
    category: 'Escalations',
    subject: '',
    body: 'Thank you for your email. This matter has been escalated to the appropriate team, and we will provide an update when available.',
    assertsAction: true,
  },
];
