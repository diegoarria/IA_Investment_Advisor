// Stub — react-native-purchases will be added when IAP is ready (fiscal docs pending)

export const ENTITLEMENT_PREMIUM = "premium";
export const PRODUCT_MONTHLY = "com.nuvosai.app.premium.monthly";
export const PRODUCT_YEARLY  = "com.nuvosai.app.premium.yearly";

export function initRevenueCat(_userId?: string) {}
export async function identifyUser(_userId: string) {}
export async function getOfferings() { return null; }
export async function purchasePackage(_pkg: any): Promise<boolean> { return false; }
export async function restorePurchases(): Promise<boolean> { return false; }
export async function getCustomerInfo() { return null; }
export function isPremium(_info: any): boolean { return false; }
