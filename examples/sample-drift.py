"""
Sample Python module demonstrating documentation drift detection.
These examples show various types of drift that Drift can detect.
"""


def calculate_discount(price: float, percentage: float, max_discount: float = None) -> float:
    """
    Calculate a discounted price.
    
    Args:
        price: The original price
        discount_rate: The discount rate (DRIFT: renamed to 'percentage')
        
    Returns:
        float: The discounted price
    """
    # DRIFT: Parameter 'discount_rate' in docs was renamed to 'percentage'
    # DRIFT: New parameter 'max_discount' is not documented
    discount = price * (percentage / 100)
    if max_discount is not None:
        discount = min(discount, max_discount)
    return price - discount


def fetch_user_data(user_id: str, include_profile: bool = True) -> dict:
    """
    Fetch user data from the database.
    
    Args:
        user_id: The unique user identifier
        include_metadata: Whether to include metadata (DRIFT: renamed to 'include_profile')
        
    Returns:
        dict: User data dictionary
        
    Raises:
        UserNotFoundError: If user doesn't exist (DRIFT: this exception class may not exist)
    """
    # DRIFT: Parameter 'include_metadata' was renamed to 'include_profile'
    # DRIFT: Documentation mentions UserNotFoundError but we raise ValueError
    if not user_id:
        raise ValueError("User ID cannot be empty")
    
    return {
        "id": user_id,
        "name": "Sample User",
        "profile": {} if include_profile else None
    }


def process_batch_items(items: list, batch_size: int = 10, callback=None) -> list:
    """
    Process items in batches using the `batch_processor` utility.
    
    Args:
        items: List of items to process
        batch_size: Number of items per batch
        
    Returns:
        list: Processed results
    """
    # DRIFT: Documentation references `batch_processor` which doesn't exist
    # DRIFT: New parameter 'callback' is not documented
    results = []
    for i in range(0, len(items), batch_size):
        batch = items[i:i + batch_size]
        processed = [item * 2 for item in batch]  # Simple processing
        if callback:
            callback(processed)
        results.extend(processed)
    return results


def format_currency(amount: float, currency: str = "USD") -> str:
    """
    Format a number as currency.
    
    Args:
        amount: The amount to format
        currency: The currency code
        
    Returns:
        str: Formatted currency string
    """
    # This documentation is perfectly in sync with the code
    symbols = {"USD": "$", "EUR": "€", "GBP": "£"}
    symbol = symbols.get(currency, currency)
    return f"{symbol}{amount:,.2f}"


class DataProcessor:
    """
    A class for processing data with configurable options.
    
    Attributes:
        config: Configuration dictionary
        validate_input: Whether to validate input (DRIFT: renamed to 'strict_mode')
    """
    
    def __init__(self, config: dict = None, strict_mode: bool = False):
        """
        Initialize the processor.
        
        Args:
            config: Optional configuration dictionary
            validate: Whether to validate (DRIFT: renamed to 'strict_mode')
        """
        # DRIFT: Parameter in docs called 'validate' but code uses 'strict_mode'
        self.config = config or {}
        self.strict_mode = strict_mode
    
    def process(self, data: dict) -> dict:
        """
        Process the input data.
        
        Args:
            data: Input data dictionary
            
        Returns:
            dict: Processed data
        """
        # This method's documentation is in sync
        if self.strict_mode and not data:
            raise ValueError("Empty data not allowed in strict mode")
        return {"processed": True, "data": data}
