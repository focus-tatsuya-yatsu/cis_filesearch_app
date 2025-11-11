# NewPasswordForm UI Design Specification

## Overview

Complete UI/UX design specification for the Cognito initial password change flow, following Apple's Human Interface Guidelines and design philosophy.

## Design Philosophy

### Core Principles (Apple HIG)

1. **Clarity**: Legible text, precise icons, subtle adornments
2. **Deference**: Content takes center stage, UI supports without competing
3. **Depth**: Realistic motion and layering to convey hierarchy

### Visual Language

- **Minimalism**: Essential elements only, generous whitespace
- **Sophistication**: Refined color palette, subtle animations
- **Familiarity**: Consistent with existing auth flows (LoginForm, ResetPasswordForm)

## Component Architecture

### File Structure

```
frontend/src/
├── components/
│   ├── Auth/
│   │   └── NewPasswordForm.tsx         # Main form component
│   └── ui/
│       └── PasswordStrengthIndicator.tsx # Strength indicator with animations
```

### Component Hierarchy

```
NewPasswordForm
├── Header Section
│   ├── Title + Badge
│   └── Subtitle
├── Form Section
│   ├── Success Message (AnimatePresence)
│   ├── Error Message (AnimatePresence)
│   ├── Info Alert
│   ├── New Password Field
│   ├── Password Strength Indicator
│   ├── Confirm Password Field
│   │   └── Match Indicator (overlay)
│   ├── Submit Button
│   └── Back Link
└── Footer
```

## Design Specifications

### 1. Layout & Spacing

**Container**:
- Max width: `28rem` (448px)
- Padding: Handled by parent layout
- Background: Transparent (glassmorphism handled by parent)

**Spacing System** (8px grid):
- Section gaps: `1.5rem` (24px) → `space-y-6`
- Field gaps: `1rem` (16px) → `space-y-4`
- Internal padding: `0.75rem` (12px) → `p-3`
- Micro-spacing: `0.5rem` (8px) → `space-y-2`

### 2. Typography

**Header**:
- Title: `text-2xl` (1.5rem/24px), `font-bold`
- Badge: `text-xs` (0.75rem/12px), `font-medium`
- Subtitle: `text-sm` (0.875rem/14px), regular weight

**Body**:
- Labels: `text-sm` (0.875rem/14px), `font-medium`
- Helper text: `text-xs` (0.75rem/12px), regular weight
- Error text: `text-sm` (0.875rem/14px), medium weight

**Footer**:
- `text-xs` (0.75rem/12px), regular weight

### 3. Color System (Apple System Colors)

#### Primary Colors
```typescript
const colors = {
  primary: {
    light: '#007AFF',
    dark: '#0A84FF'
  },
  background: {
    light: '#F5F5F7',
    dark: '#1C1C1E'
  },
  text: {
    primary: { light: '#1D1D1F', dark: '#F5F5F7' },
    secondary: { light: '#6E6E73', dark: '#98989D' }
  }
}
```

#### Semantic Colors
```typescript
const semanticColors = {
  success: {
    light: '#34C759',
    dark: '#32D74B'
  },
  error: {
    light: '#FF3B30',
    dark: '#FF453A'
  },
  warning: {
    light: '#FF9500',
    dark: '#FF9F0A'
  }
}
```

#### Password Strength Colors
```typescript
const strengthColors = {
  weak: { light: '#FF3B30', dark: '#FF453A' },
  fair: { light: '#FF9500', dark: '#FF9F0A' },
  good: { light: '#34C759', dark: '#32D74B' },
  strong: { light: '#007AFF', dark: '#0A84FF' }
}
```

### 4. Components

#### Header Badge

```tsx
<span className="inline-flex items-center px-2 py-1 rounded-md bg-[#007AFF]/10 dark:bg-[#0A84FF]/10 text-xs font-medium text-[#007AFF] dark:text-[#0A84FF]">
  初回ログイン
</span>
```

**Specifications**:
- Padding: `0.5rem 0.25rem` (8px 4px)
- Border radius: `0.375rem` (6px)
- Background: Primary color at 10% opacity
- Font size: `0.75rem` (12px)
- Font weight: `500` (medium)

#### Success Message

**Visual Design**:
- Background: Success color at 10% opacity
- Border: 1px solid success color
- Border radius: `0.75rem` (12px)
- Padding: `1rem` (16px)
- Icon: Checkmark in circle (filled)

**Animation**:
```typescript
initial={{ opacity: 0, scale: 0.95 }}
animate={{ opacity: 1, scale: 1 }}
exit={{ opacity: 0, scale: 0.95 }}
transition={{ duration: 0.3 }}
```

#### Error Message

**Visual Design**:
- Background: Error color at 10% opacity
- Border: 1px solid error color
- Border radius: `0.75rem` (12px)
- Padding: `1rem` (16px)

**Animation** (shake effect):
```typescript
initial={{ opacity: 0, x: 0 }}
animate={{ opacity: 1, x: [0, -8, 8, -4, 4, 0] }}
exit={{ opacity: 0 }}
transition={{ duration: 0.5 }}
```

#### Info Alert

**Visual Design**:
- Background: Primary color at 10% opacity
- Border: 1px solid primary color
- Border radius: `0.75rem` (12px)
- Padding: `1rem` (16px)
- Icon: Info circle (outline)

**Animation**:
```typescript
initial={{ opacity: 0, y: -8 }}
animate={{ opacity: 1, y: 0 }}
transition={{ delay: 0.1, duration: 0.3 }}
```

#### Password Strength Indicator

**Progress Bar**:
- Height: `0.25rem` (4px)
- Background: `#E5E5EA` (light) / `#3A3A3C` (dark)
- Border radius: `9999px` (full)
- Fill: Dynamic color based on strength

**Strength Calculation**:
```typescript
Score Components:
- Length >= 8 chars: +1 point
- Both upper & lower case: +1 point
- Both numbers & symbols: +1 point
- Length >= 12 chars: +1 bonus
- Multiple symbols: +1 bonus

Mapping:
- 0-2 points: Weak (25%)
- 3 points: Fair (50%)
- 4 points: Good (75%)
- 5 points: Strong (100%)
```

**Requirements Checklist**:
- Container: `bg-[#F5F5F7] dark:bg-[#1C1C1E]`, `rounded-xl`, `p-4`
- Icon size: `w-4 h-4` (16px)
- Icon background: Circle with dynamic color
- Checkmark: Animated scale effect `[1, 1.2, 1]`

#### Password Match Indicator

**Position**: Absolute overlay on confirm password field
- Right: `0.75rem` (12px)
- Top: `2.5rem` (40px)

**Icons**:
- Match: Green checkmark circle (filled)
- Mismatch: Red X circle (filled)

**Animation**:
```typescript
initial={{ scale: 0, opacity: 0 }}
animate={{ scale: 1, opacity: 1 }}
exit={{ scale: 0, opacity: 0 }}
transition={{ type: 'spring', stiffness: 500, damping: 25 }}
```

### 5. Animations & Transitions

#### Entry Animation (Form Container)

```typescript
initial={{ opacity: 0, y: 20 }}
animate={{ opacity: 1, y: 0 }}
transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
```

**Easing**: Custom cubic-bezier for smooth Apple-like motion

#### Field Validation

**Success** (checkmark appears):
```typescript
initial={{ scale: 0, opacity: 0 }}
animate={{ scale: 1, opacity: 1 }}
transition={{ duration: 0.2 }}
```

**Error** (shake animation):
```typescript
animate={{ x: [0, -4, 4, -4, 4, 0] }}
transition={{ duration: 0.4 }}
```

#### Strength Progress Bar

```typescript
initial={{ width: 0 }}
animate={{ width: `${percentage}%` }}
transition={{ duration: 0.3, ease: 'easeOut' }}
```

#### Requirements Checklist Items

**Staggered entrance**:
```typescript
initial={{ opacity: 0, x: -8 }}
animate={{ opacity: 1, x: 0 }}
transition={{ delay: index * 0.05, duration: 0.2 }}
```

### 6. Accessibility (WCAG 2.1 AA)

#### ARIA Labels

```tsx
<form
  onSubmit={handleSubmit}
  aria-label="新しいパスワード設定フォーム"
  role="form"
>
```

#### Form Fields

```tsx
<Input
  aria-describedby="password-strength"
  aria-invalid={!!passwordError}
  aria-required="true"
/>
```

#### Live Regions

```tsx
<div role="alert" aria-live="assertive">
  {error}
</div>

<div role="alert" aria-live="polite">
  {successMessage}
</div>
```

#### Keyboard Navigation

- Tab order: New password → Confirm password → Submit → Back link
- Enter: Submit form
- Escape: (Optional) Return to login

#### Focus Management

```typescript
useEffect(() => {
  newPasswordRef.current?.focus()
}, [])
```

Auto-focus on new password field on mount.

### 7. Responsive Design

#### Mobile (< 640px)
- Container: Full width with padding
- Font sizes: Same (already optimized for mobile)
- Touch targets: Minimum 44x44px (already met)

#### Tablet (640px - 1024px)
- Container: Centered, max-width maintained
- No layout changes needed

#### Desktop (> 1024px)
- Container: Centered, max-width maintained
- Hover states fully enabled

### 8. Dark Mode Support

All colors defined with light/dark variants:

```tsx
className="text-[#1D1D1F] dark:text-[#F5F5F7]"
className="bg-[#F5F5F7] dark:bg-[#1C1C1E]"
className="border-[#D1D1D6]/30 dark:border-[#38383A]/30"
```

### 9. User Flow

1. **Component Mounts**
   - Entry animation plays (0.4s)
   - Auto-focus on new password field
   - Info alert slides in (delay 0.1s)

2. **User Types New Password**
   - Real-time strength calculation
   - Progress bar animates to new percentage
   - Requirements checklist updates with checkmarks
   - Staggered item animations (50ms delay each)

3. **User Types Confirm Password**
   - Real-time match validation
   - Match/mismatch indicator appears with spring animation
   - Error message shows immediately if mismatch

4. **User Submits Form**
   - Validation runs
   - Errors shake into view (0.5s)
   - Success message scales in (0.3s)
   - 3-second countdown begins
   - Redirect to search page

### 10. Error States

#### Validation Errors

**Password too short**:
```
パスワードは8文字以上必要です
```

**Missing character types**:
```
パスワードには小文字を含めてください
パスワードには大文字を含めてください
パスワードには数字を含めてください
パスワードには記号を含めてください
```

**Passwords don't match**:
```
パスワードが一致しません
```

#### Network Errors

Handled by `getCognitoErrorMessage()` utility, displayed with shake animation.

### 11. Success State

**Message**:
```
パスワードが正常に設定されました
3秒後に検索画面に移動します...
```

**Behavior**:
- Disable all form inputs
- Show success message with checkmark icon
- Count down 3 seconds
- Redirect to `/search`

### 12. Implementation Details

#### Dependencies

```json
{
  "dependencies": {
    "framer-motion": "^11.x",
    "react": "^18.x",
    "next": "^15.x"
  }
}
```

#### File Sizes

- `NewPasswordForm.tsx`: ~390 lines
- `PasswordStrengthIndicator.tsx`: ~260 lines

#### Performance Considerations

- Memoized strength calculations with `useMemo`
- Debounced password validation (native, no external library needed)
- Minimal re-renders with proper state management

### 13. Comparison with Apple's Design

#### Similarities

1. **Typography**: SF Pro-like font stack (system-ui)
2. **Colors**: Exact Apple System Colors
3. **Spacing**: 8px grid system
4. **Animations**: Spring physics, cubic-bezier easing
5. **Accessibility**: Full ARIA support, keyboard navigation

#### Enhancements

1. **Real-time Feedback**: More immediate than typical Apple forms
2. **Visual Indicators**: Password match overlay (not in Apple's iCloud)
3. **Strength Meter**: More detailed than Apple's basic indicator

### 14. Testing Checklist

#### Visual Testing

- [ ] Light mode: All colors correct
- [ ] Dark mode: All colors correct
- [ ] Animations: Smooth 60fps
- [ ] Responsive: Works on all screen sizes

#### Functional Testing

- [ ] Password validation: All rules enforced
- [ ] Strength calculation: Accurate scores
- [ ] Match indicator: Updates correctly
- [ ] Form submission: Succeeds with valid input
- [ ] Error handling: Network errors display properly

#### Accessibility Testing

- [ ] Screen reader: All elements announced
- [ ] Keyboard: Full navigation possible
- [ ] Focus: Visible indicators
- [ ] Contrast: WCAG AA compliant (4.5:1 minimum)

#### Browser Testing

- [ ] Safari (macOS, iOS)
- [ ] Chrome (Windows, macOS, Android)
- [ ] Firefox (Windows, macOS)
- [ ] Edge (Windows)

### 15. Future Enhancements

#### Potential Additions

1. **Password History**: Prevent reuse of last N passwords
2. **Strength Tips**: Contextual suggestions for improvement
3. **Biometric Option**: Face ID / Touch ID integration
4. **Password Generator**: Suggest strong random passwords
5. **Breach Detection**: Check against known compromised passwords (Have I Been Pwned)

#### Animation Refinements

1. **Haptic Feedback**: On mobile devices (if supported)
2. **Confetti Effect**: Subtle celebration on success (optional)
3. **Micro-interactions**: Button press animations, field focus glows

## Conclusion

This NewPasswordForm implementation represents a production-ready, enterprise-grade password change interface that balances security requirements with exceptional user experience. By following Apple's design principles, we've created an interface that feels familiar, trustworthy, and sophisticated—essential qualities for a security-critical operation like password changes.

The design prioritizes:
- **User Guidance**: Clear requirements, real-time feedback
- **Visual Polish**: Smooth animations, refined color palette
- **Accessibility**: Full WCAG 2.1 AA compliance
- **Security**: Strong password enforcement, clear messaging

This specification can serve as a reference for future authentication UI components and demonstrates the level of detail required for truly exceptional user interface design.
