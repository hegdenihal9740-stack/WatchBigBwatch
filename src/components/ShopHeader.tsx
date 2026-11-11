import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Instagram, Mail, MessageCircle, MoreVertical, Phone, ShoppingCart, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useCustomer } from '@/components/CustomerAccounts';
import { AuthLink } from '@/components/AuthLink';
import { BottomNav } from '@/components/BottomNav';
import { whatsappLink } from '@/lib/whatsapp';
import { STORE_CONTACT_EMAIL_URL } from '@/lib/store-info';
import { cart, useCart } from '@/lib/cart';
import bigBLogoDark from '@/assets/big-b-logo-dark.png';
import bigBLogoLight from '@/assets/big-b-logo-light.png';

// Contact links — placeholders until the owner shares real accounts.
const contacts = [
  { label: 'WhatsApp', icon: MessageCircle, href: whatsappLink() },
  { label: 'Instagram', icon: Instagram, href: '#' },
  { label: 'Email', icon: Mail, href: STORE_CONTACT_EMAIL_URL },
];

export function ShopHeader() {
  const [menu, setMenu] = useState(false);
  const { user, ready } = useCustomer();
  const { count } = useCart();
  const [signingOut, setSigningOut] = useState(false);
  const customerName = String(user?.user_metadata?.['display_name'] ?? user?.user_metadata?.['full_name'] ?? user?.user_metadata?.['name'] ?? user?.email ?? 'Customer');
  const signOut = async () => {
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      toast.success('You have signed out.');
    } catch {
      toast.error('Could not sign out. Please try again.');
    } finally {
      setSigningOut(false);
    }
  };
  return <header className="shop-header">
    <div className="shop-menu-wrap">
      <button type="button" className="shop-icon-btn" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}><MoreVertical size={20} /></button>
      {menu && <div className="shop-menu">
        <p className="shop-menu-label"><Phone size={14} /> Contact</p>
        <div className="shop-contacts">{contacts.map(({ label, icon: Icon, href }) => <a key={label} href={href} aria-label={label} title={label} className="shop-contact" {...(label === 'WhatsApp' || label === 'Email' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}><Icon size={20} /><span>{label}</span></a>)}</div>
      </div>}
    </div>
    <Link to="/" className="shop-brand" aria-label="BIG-B home">
      <img className="shop-brand-logo shop-brand-logo-dark" src={bigBLogoDark} alt="" />
      <img className="shop-brand-logo shop-brand-logo-light" src={bigBLogoLight} alt="" />
      <span>BIG-B</span>
    </Link>
    <div className="shop-right">
      {user && <Link to="/account" className="shop-account-link"><UserRound size={16} /> Account</Link>}
      <button
        type="button"
        className="shop-desktop-cart"
        aria-label={count ? `Open cart, ${count} item${count === 1 ? '' : 's'}` : 'Open cart'}
        onClick={() => cart.setOpen(true)}
      >
        <ShoppingCart size={18} />
        <span>Cart</span>
        {count > 0 && <span className="shop-cart-badge">{count}</span>}
      </button>
      {user ? <button type="button" className="shop-login-link" disabled={signingOut} onClick={() => void signOut()}><UserRound size={16} /> {signingOut ? 'Signing out…' : `${customerName.split(' ')[0]} · Logout`}</button>
        : ready ? <AuthLink className="shop-login-link"><UserRound size={16} /> Login / Register</AuthLink>
          : <span className="shop-login-link" aria-live="polite">Loading account…</span>}
    </div>
    <BottomNav />
  </header>;
}
