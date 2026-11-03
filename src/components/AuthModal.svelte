<script>
  // AuthModal: User authentication & profile management dialog (plan Phase 5).
  // Provides Sign In, Simple Registration, Google Sign-In, and Account Switching.

  import Icon from './Icon.svelte';
  import { t } from '../lib/lang.svelte.js';
  import {
    registerUser,
    loginUser,
    loginWithGoogle,
    logoutUser,
    listUsers,
    switchAccount
  } from '../lib/auth.js';

  let {
    open = $bindable(false),
    currentUser = $bindable(),
    onAuthChange = () => {}
  } = $props();

  const tr = (k, p) => t(k, p);

  let mode = $state('login'); // 'login' | 'register'
  let username = $state('');
  let email = $state('');
  let password = $state('');
  let errorMsg = $state('');
  let isSubmitting = $state(false);

  const savedAccounts = $derived(listUsers());

  function resetForm() {
    username = '';
    email = '';
    password = '';
    errorMsg = '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    errorMsg = '';
    isSubmitting = true;

    try {
      if (mode === 'register') {
        const res = await registerUser({ username, email, password });
        if (res.ok) {
          currentUser = res.user;
          onAuthChange(res.user);
          open = false;
          resetForm();
        } else {
          errorMsg = res.error || tr('auth.invalidCredentials');
        }
      } else {
        const res = await loginUser({ identifier: username, password });
        if (res.ok) {
          currentUser = res.user;
          onAuthChange(res.user);
          open = false;
          resetForm();
        } else {
          errorMsg = res.error || tr('auth.invalidCredentials');
        }
      }
    } catch (err) {
      errorMsg = err.message || 'Authentication error';
    } finally {
      isSubmitting = false;
    }
  }

  function handleGoogleLogin() {
    const res = loginWithGoogle({
      email: email ? email : 'student@gmail.com',
      name: username ? username : 'Google Student'
    });
    if (res.ok) {
      currentUser = res.user;
      onAuthChange(res.user);
      open = false;
      resetForm();
    }
  }

  function handleSwitch(userId) {
    const user = switchAccount(userId);
    currentUser = user;
    onAuthChange(user);
    open = false;
  }

  function handleLogout() {
    const res = logoutUser();
    currentUser = res.user;
    onAuthChange(res.user);
    open = false;
  }
</script>

{#if open}
  <div
    class="modal-overlay"
    onclick={(e) => { if (e.target === e.currentTarget) open = false; }}
    onkeydown={(e) => { if (e.key === 'Escape') open = false; }}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div class="auth-card">
      <!-- Modal Header -->
      <div class="auth-header">
        <div class="auth-header-title">
          <Icon name="user" size={18} />
          <h2>{currentUser && currentUser.id !== 'guest' ? tr('auth.profile') : mode === 'login' ? tr('auth.login') : tr('auth.register')}</h2>
        </div>
        <button class="close-btn" onclick={() => open = false} title="Close" aria-label="Close">
          <Icon name="x" size={15} />
        </button>
      </div>

      <!-- If Logged In: Profile & Switcher -->
      {#if currentUser && currentUser.id !== 'guest'}
        <div class="auth-body profile-view">
          <div class="user-badge-large">
            <div class="user-avatar-circle">
              <Icon name="user" size={32} />
            </div>
            <div class="user-info-text">
              <h3>{currentUser.name || currentUser.username}</h3>
              <p class="user-meta">{currentUser.email || `@${currentUser.username}`}</p>
              <span class="provider-pill">{currentUser.provider}</span>
            </div>
          </div>

          <div class="profile-actions">
            <button class="auth-btn logout" onclick={handleLogout}>
              <Icon name="log-out" size={15} />
              <span>{tr('auth.logout')}</span>
            </button>
          </div>

          <!-- Switch Account -->
          {#if savedAccounts.length > 1}
            <div class="account-switch-section">
              <h4>{tr('auth.switchAccount')}</h4>
              <div class="accounts-list">
                {#each savedAccounts as acc (acc.id)}
                  {#if acc.id !== currentUser.id}
                    <button class="account-item-btn" onclick={() => handleSwitch(acc.id)}>
                      <Icon name="user" size={14} />
                      <span>{acc.name || acc.username}</span>
                    </button>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <!-- Login / Register Form -->
        <div class="auth-body">
          <!-- Google 1-Click Login -->
          <button class="google-btn" onclick={handleGoogleLogin} type="button">
            <Icon name="google" size={16} />
            <span>{tr('auth.googleSignIn')}</span>
          </button>

          <div class="divider">
            <span>OR</span>
          </div>

          <!-- Mode Toggle Tabs -->
          <div class="mode-tabs">
            <button
              class="tab-btn {mode === 'login' ? 'active' : ''}"
              onclick={() => { mode = 'login'; errorMsg = ''; }}
              type="button"
            >
              {tr('auth.login')}
            </button>
            <button
              class="tab-btn {mode === 'register' ? 'active' : ''}"
              onclick={() => { mode = 'register'; errorMsg = ''; }}
              type="button"
            >
              {tr('auth.register')}
            </button>
          </div>

          {#if errorMsg}
            <div class="error-banner">
              <Icon name="alert" size={14} />
              <span>{errorMsg}</span>
            </div>
          {/if}

          <form onsubmit={handleSubmit} class="auth-form">
            <label class="form-label">
              <span>{tr('auth.username')} {mode === 'login' ? ` / ${tr('auth.email')}` : ''}</span>
              <input
                type="text"
                bind:value={username}
                required
                class="form-input"
                placeholder={mode === 'login' ? 'username or email' : 'e.g. ahmed'}
                autocomplete="username"
              />
            </label>

            {#if mode === 'register'}
              <label class="form-label">
                <span>{tr('auth.email')} (optional)</span>
                <input
                  type="email"
                  bind:value={email}
                  class="form-input"
                  placeholder="e.g. ahmed@gmail.com"
                  autocomplete="email"
                />
              </label>
            {/if}

            <label class="form-label">
              <span>{tr('auth.password')}</span>
              <input
                type="password"
                bind:value={password}
                required
                class="form-input"
                placeholder="Simple & easy (min 3 chars)"
                autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>

            <button type="submit" class="submit-btn" disabled={isSubmitting}>
              <Icon name={mode === 'login' ? 'log-in' : 'check'} size={15} />
              <span>{mode === 'login' ? tr('auth.login') : tr('auth.register')}</span>
            </button>
          </form>

          <!-- Existing accounts fast switch -->
          {#if savedAccounts.length > 0}
            <div class="account-switch-section">
              <h4>{tr('auth.switchAccount')}</h4>
              <div class="accounts-list">
                {#each savedAccounts as acc (acc.id)}
                  <button class="account-item-btn" onclick={() => handleSwitch(acc.id)}>
                    <Icon name="user" size={13} />
                    <span>{acc.name || acc.username}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .auth-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    width: 380px;
    max-width: 90vw;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
    overflow: hidden;
    color: var(--text);
  }

  .auth-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }

  .auth-header-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .auth-header-title h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
  }

  .close-btn:hover {
    color: var(--text);
    background: var(--border);
  }

  .auth-body {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .google-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .google-btn:hover {
    background: var(--border);
  }

  .divider {
    display: flex;
    align-items: center;
    text-align: center;
    color: var(--muted);
    font-size: 11px;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    border-bottom: 1px solid var(--border);
  }

  .divider span {
    padding: 0 8px;
  }

  .mode-tabs {
    display: flex;
    background: var(--surface-2);
    border-radius: 6px;
    padding: 2px;
  }

  .tab-btn {
    flex: 1;
    padding: 6px;
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
    border-radius: 4px;
    cursor: pointer;
  }

  .tab-btn.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
  }

  .auth-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .form-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--muted);
  }

  .form-input {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    color: inherit;
    font-size: 13px;
  }

  .form-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .submit-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 9px;
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    margin-top: 4px;
  }

  .submit-btn:hover {
    opacity: 0.9;
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 6px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: var(--danger, #ef4444);
    font-size: 12px;
  }

  /* Profile View */
  .profile-view {
    align-items: center;
    text-align: center;
  }

  .user-badge-large {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .user-avatar-circle {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--surface-2);
    border: 2px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
  }

  .user-info-text h3 {
    margin: 0;
    font-size: 16px;
  }

  .user-meta {
    margin: 2px 0 6px;
    font-size: 12px;
    color: var(--muted);
  }

  .provider-pill {
    font-size: 10px;
    text-transform: uppercase;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--surface-2);
    border: 1px solid var(--border);
  }

  .profile-actions {
    width: 100%;
    margin-top: 10px;
  }

  .auth-btn.logout {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 8px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: inherit;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }

  .auth-btn.logout:hover {
    color: var(--danger, #ef4444);
    border-color: var(--danger, #ef4444);
  }

  .account-switch-section {
    width: 100%;
    border-top: 1px solid var(--border);
    padding-top: 10px;
    margin-top: 6px;
    text-align: start;
  }

  .account-switch-section h4 {
    margin: 0 0 6px;
    font-size: 11px;
    color: var(--muted);
  }

  .accounts-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .account-item-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface-2);
    color: inherit;
    font-size: 12px;
    cursor: pointer;
    text-align: start;
  }

  .account-item-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
