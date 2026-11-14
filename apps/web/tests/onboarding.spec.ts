import { expect, test, type Page } from '@playwright/test';

const user = { id: 'synthetic-user', name: 'Demo', email: 'demo@example.com' };
const invitation = { id: 'synthetic-invite', role: 'CAREGIVER', patient: { name: 'Demo' }, invitedBy: { name: 'Demo' } };

async function mockAccount(page: Page, signedIn = false) {
  await page.route('**/near/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/auth/get-session**', (route) => route.fulfill({ json: signedIn ? { user, session: { id: 'synthetic-session', userId: user.id, expiresAt: '2099-01-01T00:00:00Z' } } : null }));
  await page.route('**/me', (route) => route.fulfill({ json: { user, memberships: [], pendingInvitations: [invitation] } }));
}

async function startAt(page: Page, step: string, extra = {}) {
  await mockAccount(page);
  await page.addInitScript((draft) => localStorage.setItem('kuvos-web:kuvos.onboarding', JSON.stringify(draft)), {
    name: 'Demo', patientName: '', permission: false, role: 'PATIENT', step, ...extra,
  });
  await page.goto('/get-started');
}

test('name and subsequent numeric steps focus without a click; invalid Enter keeps focus', async ({ page }) => {
  await startAt(page, 'name', { name: '' });
  const name = page.getByRole('textbox', { name: 'Your name', exact: true });
  await expect(name).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(name).toBeFocused();
  await page.keyboard.type('Demo');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Me I’m the patient. Family can join later.' }).click();
  await page.getByRole('button', { name: 'Prefer not to say' }).click();
  const age = page.getByRole('textbox', { name: /How old/ });
  await expect(age).toBeFocused();
  await age.fill('1.5');
  await age.press('Enter');
  await expect(age).toHaveValue('1.5');
  await expect(age).toBeFocused();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await age.fill('35');
  await age.press('Enter');
  await expect(page.getByRole('textbox').first()).toBeFocused();
});

test('number padding and unit labels focus the right field; Tab and Enter move between feet and inches', async ({ page }) => {
  await startAt(page, 'height', { heightUnit: 'ft' });
  const feet = page.getByRole('textbox', { name: /In ft/ });
  const inches = page.getByRole('textbox', { name: /In in/ });
  await expect(feet).toBeFocused();
  await feet.fill('5');
  await expect(feet).toBeFocused();
  await feet.press('Tab');
  await expect(inches).toBeFocused();
  await page.getByText('ft', { exact: true }).click();
  await expect(feet).toBeFocused();
  await feet.press('Enter');
  await expect(inches).toBeFocused();
  await page.getByText('in', { exact: true }).click();
  await expect(inches).toBeFocused();
  const card = feet.locator('xpath=../../..');
  await card.click({ position: { x: 12, y: 40 } });
  await expect(feet).toBeFocused();
  await inches.fill('10');
  await inches.press('Enter');
  const weight = page.getByRole('textbox', { name: /weight/ });
  await expect(weight).toBeFocused();
  await weight.fill('-5');
  await weight.press('Enter');
  await expect(weight).toHaveValue('-5');
  await expect(weight).toBeFocused();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
});

test('Other conditions focuses immediately and retains focus while typing', async ({ page }) => {
  await startAt(page, 'conditions');
  await page.getByRole('checkbox', { name: 'Something else' }).click();
  const input = page.getByRole('textbox', { name: 'Other conditions' });
  await expect(input).toBeFocused();
  await page.keyboard.type('Synthetic example');
  await expect(input).toHaveValue('Synthetic example');
  await expect(input).toBeFocused();
});

test('routine times accept exact minutes and Enter continues', async ({ page }) => {
  await startAt(page, 'wake');
  const time = page.locator('input[type=time]');
  await expect(time).toBeFocused();
  await time.fill('07:10');
  await time.press('Enter');
  await expect(page.getByRole('heading', { name: /sleep|bed/i })).toBeVisible();
  await expect(time).toBeFocused();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('kuvos-web:kuvos.onboarding')!).wake)).toBe('07:10');
});

test('helper email focuses, validates, and sends once while a request is pending', async ({ page }) => {
  await mockAccount(page, true);
  let requests = 0;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  await page.route('**/patients/synthetic-patient/invitations', async (route) => {
    requests++;
    await pending;
    await route.fulfill({ json: {} });
  });
  await page.goto('/helpers?patientId=synthetic-patient&role=CAREGIVER');
  const email = page.getByRole('textbox');
  await expect(email).toBeFocused();
  await email.fill('invalid');
  await email.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Enter a valid email');
  await expect(email).toBeFocused();
  await email.fill('helper@example.com');
  await email.press('Enter');
  await expect(email).not.toBeEditable();
  await page.keyboard.press('Enter');
  await expect.poll(() => requests).toBe(1);
  finish();
  await expect(page.getByRole('button', { name: 'Go to Today' })).toBeVisible();
  expect(requests).toBe(1);
});

for (const flow of ['invite', 'invitation']) {
  test(`${flow} focuses its input and submits on Enter`, async ({ page }) => {
    await mockAccount(page, true);
    let requests = 0;
    await page.route(flow === 'invite' ? '**/patients/synthetic-patient/invitations' : '**/invitations/synthetic-invite/accept', (route) => {
      requests++;
      return route.fulfill({ status: 400, json: { message: 'Synthetic retry error' } });
    });
    await page.goto(`/${flow}?patientId=synthetic-patient&role=CAREGIVER`);
    const input = page.getByRole('textbox');
    await expect(input).toBeFocused();
    await input.fill(flow === 'invite' ? 'helper@example.com' : 'Demo Helper');
    await input.press('Enter');
    await expect.poll(() => requests).toBe(1);
    await expect(page.getByRole('alert')).toBeVisible();
  });
}
