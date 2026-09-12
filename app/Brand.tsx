import Image from "next/image";

// Shared logo mark used in the sidebar (.brand) and mobile topbar
// (.mobile-brand). Keep this in sync with app/globals.css's .brand-mark
// rules, which style it as a 30x30 image with a transparent background.
export function BrandMark() {
  return (
    <Image
      className="brand-mark"
      src="/Runloop%20Logo.png"
      alt=""
      width={30}
      height={30}
      priority
    />
  );
}
